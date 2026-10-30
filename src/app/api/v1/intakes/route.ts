import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { apiError, secureEqual } from "@/lib/auth";
import { encryptNarrative } from "@/lib/crypto";
import { completedActivityTemporalError, ingestionSchema } from "@/lib/domain";
import { adminClient } from "@/lib/supabase/admin";
import { assertTimelineIntegrity } from "@/lib/timeline-integrity";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SOURCE_AGE_MS = 10 * 60 * 1000;
const RATE_LIMIT = 30;

export async function POST(request: NextRequest) {
  const expected = process.env.GPT_INGESTION_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !secureEqual(supplied, expected)) return apiError(401, "invalid_api_key");

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return apiError(413, "payload_too_large");

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return apiError(413, "payload_too_large");
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return apiError(400, "invalid_json"); }
  const parsed = ingestionSchema.safeParse(json);
  if (!parsed.success) return apiError(422, "validation_failed", parsed.error.flatten());
  const temporalError = completedActivityTemporalError(parsed.data.slices);
  if (temporalError) return apiError(422, temporalError);

  if (parsed.data.source_timestamp) {
    const age = Math.abs(Date.now() - new Date(parsed.data.source_timestamp).getTime());
    if (age > MAX_SOURCE_AGE_MS) return apiError(400, "stale_source_timestamp");
  }

  const supabase = adminClient();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const bucket = `${ipHash}:${new Date().toISOString().slice(0, 16)}`;
  const { data: allowed, error: rateError } = await supabase.rpc("consume_ingestion_rate_limit", { p_bucket: bucket, p_limit: RATE_LIMIT });
  if (rateError) return apiError(503, "rate_limit_unavailable");
  if (!allowed) return apiError(429, "rate_limited");

  const configuredEmail = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",")[0]?.trim().toLowerCase();
  if (!configuredEmail) return apiError(503, "owner_not_configured");
  const { data: owner } = await supabase.from("members").select("id").ilike("email", configuredEmail).maybeSingle();
  if (!owner) return apiError(503, "owner_not_initialized");

  const { data: existing } = await supabase.from("intake_sessions").select("id").eq("idempotency_key", parsed.data.idempotency_key).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, intake_session_id: existing.id, duplicate: true });

  try {
    await assertTimelineIntegrity(supabase, owner.id, parsed.data.slices.map((slice, index) => ({
      id: `submission-${index}`, start_at: slice.start_at, end_at: slice.end_at, community: slice.community,
    })));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("timeline_overlap:")) {
      return apiError(409, "timeline_overlap", { conflict: error.message.slice("timeline_overlap:".length) });
    }
    return apiError(503, "timeline_integrity_unavailable");
  }

  let encrypted;
  try { encrypted = encryptNarrative(parsed.data.raw_narrative); }
  catch (error) { return apiError(503, "encryption_unavailable", error instanceof Error ? error.message : undefined); }

  const { data: intake, error: intakeError } = await supabase.from("intake_sessions").insert({
    owner_id: owner.id,
    source: "custom_gpt",
    parser_version: parsed.data.parser_version,
    idempotency_key: parsed.data.idempotency_key,
    source_timestamp: parsed.data.source_timestamp,
    timezone: parsed.data.timezone,
    narrative_ciphertext: encrypted.ciphertext,
    narrative_iv: encrypted.iv,
    narrative_auth_tag: encrypted.authTag,
    narrative_key_version: encrypted.keyVersion,
    narrative_digest: encrypted.digest,
  }).select("id").single();
  if (intakeError || !intake) {
    if (intakeError?.code === "23505") {
      const { data: duplicate } = await supabase.from("intake_sessions").select("id").eq("idempotency_key", parsed.data.idempotency_key).maybeSingle();
      if (duplicate) return NextResponse.json({ ok: true, intake_session_id: duplicate.id, duplicate: true });
    }
    return apiError(500, "intake_insert_failed");
  }

  const drafts = parsed.data.slices.map((slice) => ({
    ...slice,
    intake_session_id: intake.id,
    owner_id: owner.id,
  }));
  const { data: inserted, error: draftError } = await supabase.from("draft_slices").insert(drafts).select("id");
  if (draftError) {
    await supabase.from("intake_sessions").delete().eq("id", intake.id);
    return apiError(500, "draft_insert_failed");
  }
  const canonicalRows = parsed.data.slices.map((slice, index) => ({
      protocol_link_id: randomUUID(),
      activity_occurrence_id: slice.activity_occurrence_id ?? randomUUID(),
      revision_number: 1,
      draft_slice_id: inserted[index].id,
      owner_id: owner.id,
      ...slice,
      status: "validation_pending",
  }));
  const { data: canonical, error: canonicalError } = await supabase.from("canonical_slices").insert(canonicalRows).select("id,draft_slice_id");
  if (canonicalError || !canonical) return apiError(500, "observer_confirmation_failed");
  await supabase.from("observer_events").insert(canonical.map((row) => ({
      draft_slice_id: row.draft_slice_id,
      canonical_slice_id: row.id,
      owner_id: owner.id,
      actor_id: owner.id,
      decision: "approved",
      rationale: `Confirmed in private Custom GPT: ${parsed.data.observer_confirmation.confirmation_text}`,
  })));
  await supabase.from("draft_slices").update({ status: "observer_approved" }).in("id", inserted.map(({ id }) => id));
  const observerApprovedCount = canonical.length;
  await supabase.from("audit_events").insert({
    owner_id: owner.id,
    actor_type: "machine",
    event_type: "gpt_intake_created",
    entity_type: "intake_session",
    entity_id: intake.id,
    request_ip_hash: ipHash,
    metadata: {
      parser_version: parsed.data.parser_version,
      draft_count: inserted.length,
      observer_confirmation_channel: parsed.data.observer_confirmation.channel,
      observer_approved_count: observerApprovedCount,
      identity_assurance: "private_gpt_pilot_trust",
    },
  });

  return NextResponse.json({
    ok: true,
    intake_session_id: intake.id,
    draft_slice_ids: inserted.map(({ id }) => id),
    observer_approved_count: observerApprovedCount,
    next_step: "Open Value Log to confirm evidence by community role.",
  }, { status: 201 });
}
