// Local-only synthetic service for exercising the real Next.js member screens.
// Never reads deployment env files or accepts a production connection.
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
const native = true;
const drafts = new Map();
const app = "http://127.0.0.1:4208",
  api = "http://127.0.0.1:4209";
const ownerA = "22222222-2222-4222-8222-222222222222",
  ownerB = "33333333-3333-4333-8333-333333333333";
const ownerMoses = "11111111-1111-4111-8111-111111111111";
const members = new Map([
  [
    ownerA,
    {
      display_name: "Synthetic member A",
      timezone: "Asia/Kolkata",
      onboarded: native,
    },
  ],
  [
    ownerB,
    {
      display_name: "Synthetic member B",
      timezone: "Europe/London",
      onboarded: true,
    },
  ],
]);
const entries = new Map(),
  audit = [],
  jwtKey = randomBytes(32),
  encryptionKey = randomBytes(32).toString("base64"),
  digestKey = randomBytes(32).toString("hex");
const token = (id) => {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const p = Buffer.from(
    JSON.stringify({
      sub: id,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  return `${h}.${p}.${createHmac("sha256", jwtKey).update(`${h}.${p}`).digest("base64url")}`;
};
function subject(req) {
  try {
    const t = req.headers.authorization?.replace(/^Bearer /, "") || "",
      [h, p, s] = t.split(".");
    if (
      createHmac("sha256", jwtKey).update(`${h}.${p}`).digest("base64url") !== s
    )
      return null;
    return JSON.parse(Buffer.from(p, "base64url").toString()).sub;
  } catch {
    return null;
  }
}
const user = (id) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email:
    id === ownerMoses
      ? "original-pilot@example.test"
      : `synthetic-${id.slice(0, 8)}@members.valuelog.invalid`,
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-10-25T00:00:00Z",
});
members.set(ownerMoses, {
  display_name: "Synthetic pilot owner",
  timezone: "Asia/Kolkata",
  onboarded: true,
});
const tableData = new Map([
  [
    "cohort_communities",
    [
      {
        id: "house_of_bros",
        name: "HouseOfBros",
        kind: "wellbecoming",
        active: true,
      },
      {
        id: "house_of_sis",
        name: "HouseOfSis",
        kind: "wellbecoming",
        active: true,
      },
      {
        id: "test_project",
        name: "Synthetic project",
        kind: "work",
        active: true,
      },
    ],
  ],
  ...[
    "cohort_enrollments",
    "cohort_memberships",
    "cohort_reviewer_delegations",
    "cohort_rate_policies",
    "cohort_records",
    "cohort_review_events",
    "cohort_replay_runs",
  ].map((t) => [t, []]),
  [
    "cohort_agents",
    [
      {
        id: "system:field-station-reviewer:v1",
        operator_label: "Synthetic operator",
        operator_did: "did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        active: true,
        accepted_at: new Date().toISOString(),
        version: 1,
      },
    ],
  ],
  [
    "cohort_invitations",
    [
      {
        id: randomUUID(),
        token_hash: createHmac("sha256", digestKey)
          .update("cohort-invitation:v1:" + "s".repeat(43))
          .digest("hex"),
        target_did: null,
        community_ids: ["test_project"],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date().toISOString(),
        revoked_at: null,
        redeemed_by: null,
      },
    ],
  ],
]);
const rowsFor = (t) => tableData.get(t) || [];
const didFor = (id) =>
  "did:iov:member:" +
  (id === ownerMoses
    ? "10000000-0000-4000-8000-000000000001"
    : id === ownerA
      ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const now = () => new Date().toISOString();
let failSave = false,
  expiredSession = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, api),
    owner = subject(req);
  const json = (value, status = 200, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(value));
  };
  if (
    url.pathname === "/test-native-job" ||
    url.pathname === "/test-cohort-job"
  ) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const path = url.pathname,
      signature =
        req.headers[
          path === "/test-native-job"
            ? "x-value-log-native-job"
            : "x-cohort-job"
        ] || "";
    setTimeout(async () => {
      try {
        if (path === "/test-native-job") {
          const { runNativeStructure } = await import(
            "../src/lib/native-log/structure-worker.ts"
          );
          await runNativeStructure(raw, signature);
        } else {
          const { runCohortReview } = await import(
            "../src/lib/cohort/review-worker.ts"
          );
          await runCohortReview(raw, signature);
        }
      } catch (error) {
        console.error("synthetic worker failed", error.message);
      }
    }, 30);
    return json({}, 202);
  }
  if (url.pathname.startsWith("/test-provider/")) {
    if (req.headers["api-subscription-key"] !== "synthetic-native-provider")
      return json({ error: "synthetic key required" }, 403);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (url.pathname.endsWith("speech-to-text"))
      return json({ transcript: "I walked from 8am to 8:30am. Felt better." });
    const envelope = JSON.parse(raw),
      input = JSON.parse(envelope.messages[1].content);
    if ((envelope.response_format.json_schema?.name ?? envelope.messages[0].content.match(/^Operation: ([a-z_]+)/)?.[1]) === "cohort_review_batch")
      return json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                decisions: input.records.map((r) => ({
                  recordId: r.recordId,
                  supportedNode:"Physiology",
                  decision: {
                    outcome: "reviewed",
                    rationale:
                      "Synthetic policy review: the participant confirmed a supported activity and effect.",
                    question: "",
                    evidenceQuotes: [r.activity.quote || r.activity.activity],
                  },
                })),
              }),
            },
          },
        ],
      });
    if(envelope.messages[0].content.startsWith("Operation: value_log_conversation\n")) {
      const current=input.activities||[],first=current[0];
      const updates=first?[{id:first.id,changes:{endLocal:input.date+"T09:00"}}]:[];
      return json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({updates,additions:[],removed:[]})}}]});
    }
    if(input.transcript?.includes("7:15")) {
      const quotes=["after uh 7:15, 7:30 I met friends. Then we walked around a farm and exercised, came back around 8:30.","and talked to my neighbour till like 9:30","then had breakfast till 10:30","then attended the daily standup, and that just got over. And now it's 11:30 a.m."];
      const activities=quotes.map((sourceQuote,i)=>({id:null,activity:["Walk and exercise","Conversation","Breakfast","Standup"][i],sourceQuote,startLocal:null,endLocal:null,node:i===3?"Performance":i===1?"Feeling":"Physiology",context:null,proof:null,sleepRest:false,community:null,lane:null,direction:null,intensity:null,confidence:null}));
      return json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({activities})}}]});
    }
    if(envelope.messages[0].content.startsWith("Operation: value_log_reply\n"))return json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({remove:false,changes:{endLocal:input.date+"T00:35"}})}}]});
    const last = input.followUpAnswers?.at(-1),
      existing = input.existingActivities || [];
    const activities = existing.length
      ? existing.map((a) => ({
          id: a.id,
          exclude: false,
          changedFields: ["endLocal"],
          activity: a.activity,
          sourceQuote: a.sourceQuote,
          startLocal: a.startLocal,
          endLocal:
            last && (!last.activityId || last.activityId === a.id)
              ? input.date + "T00:35"
              : a.endLocal || null,
          node: a.node,
          context: a.context || null,
          proof: a.proof || null,
          sleepRest: false,
          community: a.community || null,
          lane: a.lane || null,
          direction: "positive",
          intensity: "low",
          confidence: "observed",
        }))
      : [
          {
            id: null,
            activity: "Synthetic walk",
            sourceQuote: input.transcript,
            startLocal: input.date + "T00:05",
            endLocal: null,
            node: "Physiology",
            context: null,
            proof: null,
            sleepRest: false,
            community: null,
            lane: null,
            direction: "positive",
            intensity: "low",
            confidence: "observed",
          },
        ];
    return json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ activities }) },
        },
      ],
    });
  }
  if (url.pathname.startsWith("/test/")) {
    if (url.pathname === "/test/expire") {
      expiredSession = true;
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/test/fail-next-save") {
      failSave = true;
      res.writeHead(302, { location: app + "/day" });
      res.end();
      return;
    }
    expiredSession = false;
    const id =
        url.pathname === "/test/member-b"
          ? ownerB
          : url.pathname === "/test/pilot"
            ? ownerMoses
            : ownerA,
      cookies = [];
    const sb = createServerClient(api, "synthetic-anon", {
      cookies: { getAll: () => [], setAll: (items) => cookies.push(...items) },
    });
    const result = await sb.auth.setSession({
      access_token: token(id),
      refresh_token: "synthetic-refresh",
    });
    if (result.error) return json({ error: "fixture session failed" }, 500);
    res.writeHead(302, {
      "set-cookie": cookies.map(
        (c) => `${c.name}=${c.value}; Path=/; SameSite=Lax`,
      ),
      location: app + "/day",
    });
    res.end();
    return;
  }
  if (url.pathname === "/auth/v1/user")
    return owner && !expiredSession
      ? json(user(owner))
      : json({ msg: "invalid synthetic session" }, 401);
  if (url.pathname === "/auth/v1/logout") return json({});
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    if (req.headers.authorization !== "Bearer synthetic-service")
      return json({ message: "service required" }, 403);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const p = JSON.parse(raw),
      name = url.pathname.split("/").at(-1);
    const m = members.get(p.p_owner_id || p.p_owner || p.p_actor);
    if (name === "consume_ingestion_rate_limit") return json(true);
    if (name === "cohort_is_admin") return json(p.p_actor === ownerMoses);
    if (name === "cohort_command") {
      const x = p.p_input,
        stamp = now();
      if (p.p_action === "enroll") {
        const invitation = rowsFor("cohort_invitations").find(
          (i) => i.token_hash === x.hash,
        );
        if (!invitation)
          return json({ message: "INVITATION_UNAVAILABLE" }, 409);
        if (
          !rowsFor("cohort_enrollments").some((e) => e.owner_id === p.p_actor)
        ) {
          const date = new Intl.DateTimeFormat("en-CA", {
            timeZone: members.get(p.p_actor).timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          rowsFor("cohort_enrollments").push({
            owner_id: p.p_actor,
            did: didFor(p.p_actor),
            policy_id: "field-station-assumed-700-v1",
            house_id: x.house,
            timezone: members.get(p.p_actor).timezone,
            boundary_at: new Date(date + "T00:00:00+05:30").toISOString(),
            consent_at: stamp,
            review_consent: true,
            active: true,
            revision: 1,
            permissions_revision: 1,
            calculated_revision: 0,
            current_replay_id: null,
            created_at: stamp,
          });
          for (const cid of [x.house, ...x.communities])
            rowsFor("cohort_memberships").push({
              id: randomUUID(),
              owner_id: p.p_actor,
              community_id: cid,
              accepted_at: stamp,
              revoked_at: null,
              created_at: stamp,
            });
          rowsFor("cohort_reviewer_delegations").push({
            id: randomUUID(),
            owner_id: p.p_actor,
            actor_id: "system:field-station-reviewer:v1",
            policy_id: "field-station-assumed-700-v1",
            revoked_at: null,
            granted_at: stamp,
          });
          if (x.salary)
            rowsFor("cohort_rate_policies").push({
              id: x.rateId,
              owner_id: p.p_actor,
              content: x.salary,
              effective_at: new Date(date + "T00:00:00+05:30").toISOString(),
              created_at: stamp,
            });
          invitation.redeemed_by = p.p_actor;
          invitation.redeemed_at = stamp;
        }
      } else if (p.p_action === "consent") {
        const e = rowsFor("cohort_enrollments").find(
          (e) => e.owner_id === p.p_actor,
        );
        e.active = x.consent;
        e.review_consent = x.consent;
        e.revision++;
        e.permissions_revision++;
      } else if (p.p_action === "appeal") {
        const r = rowsFor("cohort_records").find(
          (r) => r.owner_id === p.p_actor && r.id === x.recordId,
        );
        if (!r) return json({ message: "UNAUTHORIZED" }, 403);
        r.review_status = "escalated";
        rowsFor("cohort_review_events").push({
          id: x.id,
          owner_id: p.p_actor,
          record_id: r.id,
          actor_id: "member:" + p.p_actor,
          outcome: "appealed",
          content: x.content,
          input_digest: r.content.digest,
          created_at: stamp,
        });
      } else if (p.p_action === "rate")
        rowsFor("cohort_rate_policies").push({
          id: x.id,
          owner_id: p.p_actor,
          content: x.content,
          effective_at: stamp,
          created_at: stamp,
        });
      return json({ saved: true });
    }
    if (name === "confirm_cohort_log") {
      const d = drafts.get(p.p_owner + ":" + p.p_id),
        e = rowsFor("cohort_enrollments").find((e) => e.owner_id === p.p_owner);
      if (d?.receipt) return json(d.receipt);
      if (!d || !e || !e.active || d.revision !== p.p_revision)
        return json({ message: "REVISION_CONFLICT" }, 409);
      const original = rowsFor("cohort_records").find(
        (r) => r.id === p.p_corrects && r.owner_id === p.p_owner,
      );
      if (original) original.review_status = "superseded";
      for (const item of p.p_entries) {
        const rate = rowsFor("cohort_rate_policies")
          .filter(
            (r) => r.owner_id === p.p_owner && r.effective_at <= item.start,
          )
          .at(-1);
        rowsFor("cohort_records").push({
          id: item.id,
          owner_id: p.p_owner,
          native_draft_id: p.p_id,
          occurrence_id: item.occurrenceId,
          revision: original ? original.revision + 1 : 1,
          supersedes: p.p_corrects || null,
          start_at: item.start,
          end_at: item.end,
          content: item.content,
          policy_id: e.policy_id,
          rate_policy_id: rate?.id || null,
          review_status: "pending",
          lease_token: null,
          lease_until: null,
          created_at: now(),
        });
      }
      d.status = "submitted";
      d.receipt = p.p_receipt;
      d.revision++;
      e.revision++;
      return json(p.p_receipt);
    }
    if (name === "claim_cohort_review") {
      const r = rowsFor("cohort_records").find(
          (r) => r.id === p.p_id && r.owner_id === p.p_owner,
        ),
        e = rowsFor("cohort_enrollments").find((e) => e.owner_id === p.p_owner),
        agent = rowsFor("cohort_agents")[0],
        delegation = rowsFor("cohort_reviewer_delegations").find(
          (d) => d.owner_id === p.p_owner && !d.revoked_at,
        );
      if (
        !r ||
        !e?.active ||
        !e.review_consent ||
        !agent.active ||
        !delegation ||
        r.review_status !== "pending" ||
        (r.lease_until && Date.parse(r.lease_until) > Date.now())
      )
        return json(null);
      r.lease_token = p.p_token;
      r.lease_until = new Date(Date.now() + 150000).toISOString();
      r.lease_context_revision = e.permissions_revision;
      r.lease_agent_version = agent.version;
      return json({ record: r, delegation, agent });
    }
    if (name === "finish_cohort_review") {
      const r = rowsFor("cohort_records").find(
          (r) => r.id === p.p_id && r.owner_id === p.p_owner,
        ),
        e = rowsFor("cohort_enrollments").find((e) => e.owner_id === p.p_owner);
      if (
        !r ||
        !e.active ||
        !e.review_consent ||
        r.lease_token !== p.p_token ||
        r.review_status !== "pending"
      )
        return json(false);
      rowsFor("cohort_review_events").push({
        id: p.p_event,
        owner_id: p.p_owner,
        record_id: r.id,
        actor_id: "system:field-station-reviewer:v1",
        outcome: p.p_outcome,
        input_digest: p.p_digest,
        content: p.p_content,
        created_at: now(),
      });
      r.review_status = p.p_outcome;
      r.lease_token = null;
      r.lease_until = null;
      e.revision++;
      return json(true);
    }
    if (name === "promote_cohort_replay") {
      const e = rowsFor("cohort_enrollments").find(
        (e) => e.owner_id === p.p_owner,
      );
      if (!e || e.revision !== p.p_revision) return json(false);
      rowsFor("cohort_replay_runs").push({
        id: p.p_id,
        owner_id: p.p_owner,
        policy_id: e.policy_id,
        input_digest: p.p_input,
        output_digest: p.p_output,
        verification_passed: true,
        content: p.p_content,
        created_at: now(),
      });
      e.current_replay_id = p.p_id;
      e.calculated_revision=p.p_revision;
      return json(true);
    }

    if (!m) return json({ message: "unknown fixture member" }, 403);
    if (name.includes("native_log")) {
      const key = p.p_owner + ":" + p.p_id,
        previous = drafts.get(key);
      if (name === "save_native_log_draft") {
        if (failSave) {
          failSave = false;
          return json({ message: "synthetic save failure" }, 503);
        }
        if (previous && previous.revision !== p.p_revision) {
          if (
            previous.revision === p.p_revision + 1 &&
            previous.content_digest === p.p_content.digest
          )
            return json(previous.revision);
          return json({ message: "REVISION_CONFLICT" }, 409);
        }
        const c = p.p_content,
          now = new Date().toISOString();
        drafts.set(key, {
          ...previous,
          id: p.p_id,
          owner_id: p.p_owner,
          revision: p.p_revision + 1,
          status: "draft",
          content_ciphertext: c.ciphertext,
          content_iv: c.iv,
          content_auth_tag: c.authTag,
          content_digest: c.digest,
          content_key_version: c.keyVersion,
          lease_token: null,
          lease_until: null,
          receipt: null,
          created_at: previous?.created_at || now,
          updated_at: now,
          removed_at: null,
        });
        return json(p.p_revision + 1);
      }
      if (!previous) return json({ message: "NATIVE_DRAFT_CLOSED" }, 404);
      if (name === "reserve_native_log_processing") {
        previous.lease_token = randomUUID();
        previous.lease_until = new Date(Date.now() + 75000).toISOString();
        return json(previous.lease_token);
      }
      if (name === "release_native_log_processing") return json(null);
      if (name === "confirm_native_log") {
        if (previous.receipt) return json(previous.receipt);
        if (previous.revision !== p.p_revision)
          return json({ message: "REVISION_CONFLICT" }, 409);
        for (const item of p.p_entries) {
          const c = item.content,
            now = new Date().toISOString();
          entries.set(p.p_owner + ":" + item.id, {
            id: item.id,
            owner_id: p.p_owner,
            revision: 1,
            activity_date: item.date,
            wellbeing_node: item.node,
            content_ciphertext: c.ciphertext,
            content_iv: c.iv,
            content_auth_tag: c.authTag,
            content_digest: c.digest,
            created_at: now,
            updated_at: now,
            removed_at: null,
          });
        }
        previous.status = "submitted";
        previous.revision++;
        previous.receipt = { ...p.p_receipt, intakeId: null };
        return json(previous.receipt);
      }
      if (name === "remove_native_log_draft") {
        previous.status = "removed";
        previous.content_ciphertext = null;
        previous.content_iv = null;
        previous.content_auth_tag = null;
        previous.removed_at = new Date().toISOString();
        previous.revision++;
        return json(true);
      }
    }
    if (name === "setup_value_log_member") {
      m.display_name = p.p_name;
      m.timezone = p.p_timezone;
      m.onboarded = true;
      return json(true);
    }
    if (name === "save_value_log_member_entry") {
      if (failSave) {
        failSave = false;
        return json({ message: "synthetic network failure" }, 503);
      }
      const key = p.p_owner_id + ":" + p.p_id,
        previous = entries.get(key);
      if (previous && previous.revision !== p.p_revision) {
        if (
          previous.revision === p.p_revision + 1 &&
          previous.content_digest === p.p_content.digest
        )
          return json(previous.revision);
        return json({ message: "revision_conflict" }, 409);
      }
      const content = p.p_content,
        now = new Date().toISOString();
      entries.set(key, {
        id: p.p_id,
        owner_id: p.p_owner_id,
        revision: p.p_revision + 1,
        activity_date: p.p_remove ? null : p.p_date,
        wellbeing_node: p.p_remove ? null : p.p_node,
        content_ciphertext: p.p_remove ? null : content.ciphertext,
        content_iv: p.p_remove ? null : content.iv,
        content_auth_tag: p.p_remove ? null : content.authTag,
        content_key_version: p.p_remove ? null : content.keyVersion,
        content_digest: content.digest,
        created_at: previous?.created_at || now,
        updated_at: now,
        removed_at: p.p_remove ? now : null,
      });
      audit.push({
        id: String(audit.length),
        owner_id: p.p_owner_id,
        event_type: p.p_remove
          ? "private_activity_removed"
          : "private_activity_saved",
        metadata: { revision: p.p_revision + 1 },
        created_at: now,
      });
      return json(p.p_revision + 1);
    }
    return json({ message: "unsupported fixture RPC" }, 400);
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const service = req.headers.authorization === "Bearer synthetic-service";
    if (!owner && !service) return json({ message: "sign in required" }, 401);
    const table = url.pathname.split("/").at(-1),
      m = members.get(owner);
    let rows = rowsFor(table).map((r) => r);
    if (table === "members")
      rows = service
        ? [...members].map(([id, m]) => ({ id, ...m }))
        : [{ id: owner, ...m }];
    if (table === "member_log_access")
      rows = [
        {
          owner_id: owner,
          onboarded_at: m.onboarded ? "2026-10-25T00:00:00Z" : null,
        },
      ];
    if (table === "member_identity_bindings")
      rows = (service ? [...members.keys()] : [owner]).map((id) => ({
        owner_id: id,
        did: didFor(id),
      }));
    if (table === "member_activity_entries")
      rows = [...entries.values()].filter((e) => e.owner_id === owner);
    if (table === "native_log_drafts")
      rows = [...drafts.values()].filter(
        (e) => service || e.owner_id === owner,
      );
    if (table === "audit_events")
      rows = audit.filter((e) => e.owner_id === owner);
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq."))
        rows = rows.filter((r) => String(key==="receipt->>kind"?r.receipt?.kind:r[key]) === value.slice(3));
      if (value.startsWith("neq."))
        rows = rows.filter((r) => String(r[key]) !== value.slice(4));
      if (value.startsWith("gt."))
        rows = rows.filter((r) => String(r[key]) > value.slice(3));
      if (value.startsWith("lte."))
        rows = rows.filter((r) => String(r[key]) <= value.slice(4));
      if (value === "is.null") rows = rows.filter((r) => r[key] == null);
      if (value.startsWith("in.("))
        rows = rows.filter((r) =>
          value.slice(4, -1).split(",").includes(String(r[key])),
        );
    }
    if (req.method === "PATCH") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const patch = JSON.parse(raw);
      for (const row of rows) Object.assign(row, patch);
    }
    if (url.searchParams.get("order")?.startsWith("id"))
      rows.sort((a, b) => a.id.localeCompare(b.id));
    const count = rows.length,
      offset = Number(url.searchParams.get("offset") || 0),
      limit = Number(url.searchParams.get("limit") || 1000);
    rows = rows.slice(offset, offset + limit);
    return json(
      req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] || null : rows,
      200,
      {
        "content-range": `${offset}-${Math.max(offset, offset + rows.length - 1)}/${count}`,
      },
    );
  }
  json({ fixture: "local synthetic member A/B; no production connection" });
});
await new Promise((resolve) => server.listen(4209, "127.0.0.1", resolve));
writeFileSync("/private/tmp/iov-cohort-fixture.pid", String(process.pid));
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: api,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  NARRATIVE_ENCRYPTION_KEY_BASE64: encryptionKey,
  AUDIT_DIGEST_KEY: digestKey,
  NEXT_PUBLIC_APP_URL: app,
  SARVAM_API_KEY: "synthetic-native-provider",
  VALUE_LOG_NATIVE_LOGGING: "open",
  VALUE_LOG_COHORT_ENROLLMENT: "open",
  VALUE_LOG_COHORT_REVIEW: "open",
  VALUE_LOG_COHORT_CALCULATION: "open",
});
await import("./cohort-provider-fixture.mjs");
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/cohort-provider-fixture.mjs",
    "node_modules/next/dist/bin/next",
    ...(process.env.IOV_FIXTURE_DEV === "true" ? ["dev", "--webpack"] : ["start"]),
    "-H",
    "127.0.0.1",
    "-p",
    "4208",
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: api,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
      NARRATIVE_ENCRYPTION_KEY_BASE64: encryptionKey,
      AUDIT_DIGEST_KEY: digestKey,
      NARRATIVE_KEY_VERSION: "1",
      MOSES_EMAIL_ALLOWLIST: "original-pilot@example.test",
      VALUE_LOG_MEMBER_ADMISSION: "closed",
      VALUE_LOG_MEMBER_WRITING: "open",
      NEXT_PUBLIC_APP_URL: app,
      VALUE_LOG_NATIVE_LOGGING: "open",
      SARVAM_API_KEY: "synthetic-native-provider",
      VALUE_LOG_COHORT_ENROLLMENT: "open",
      VALUE_LOG_COHORT_REVIEW: "open",
      VALUE_LOG_COHORT_CALCULATION: "open",
    },
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill("SIGTERM");
    server.close(() => process.exit(0));
  });
console.log("Synthetic cohort entry: http://127.0.0.1:4209/test/member-a");
console.log(
  "Synthetic invitation: http://127.0.0.1:4208/onboarding/field-station?invite=" +
    "s".repeat(43),
);
