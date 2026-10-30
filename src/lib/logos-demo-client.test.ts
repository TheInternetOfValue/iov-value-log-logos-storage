import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const csv: Record<string, string> = {
  "cid-slices": "id,owner_id,start_at,end_at,timezone,activity,status,is_current,wellbeing_node,slice_type,community\n" +
    "s1,o1,2026-10-28T01:00:00+00:00,2026-10-28T02:00:00+00:00,Asia/Kolkata,Walk,calculated,True,Physiology,non_performance,house_of_bros\n" +
    "s2,o1,2026-10-27T20:00:00+00:00,2026-10-27T21:00:00+00:00,Asia/Kolkata,\"Read, then slept\",calculated,True,Thought,non_performance,house_of_bros\n" +
    "s0,o1,2026-10-27T20:00:00+00:00,2026-10-27T21:00:00+00:00,Asia/Kolkata,Old,superseded,False,Thought,non_performance,house_of_bros\n",
  "cid-baseline": "replay_run_id,mode,baseline_effective_at,baseline_wellbeing_score\nrun1,founder_v0_1_live,2026-07-28T11:11:34+00:00,771.000000000000\n",
  "cid-events": "id,canonical_slice_id,event_kind,w_before,w_after,delta_w,vcperformance_event_amount,protocol_finality_status,payability_status\n" +
    "e1,s1,nonperformance,771.5,771.6,0.1,,final,non_payable\n",
};
vi.mock("node:fs", () => ({
  existsSync: (path: string) => !String(path).includes("demo-writes"),
  writeFileSync: () => undefined,
  statSync: () => ({ mtimeMs: 1 }),
  readFileSync: () => JSON.stringify({ canonical_slices: { cid: "cid-slices" }, current_promoted_founder_replay: { cid: "cid-baseline" }, founder_wellbeing_value_events: { cid: "cid-events" } }),
}));
vi.mock("./logos-demo", () => ({ logosDemoFetch: async (cid: string) => csv[cid], logosDemoStore: async () => "cid-writes", logosDemoDelete: async () => undefined, logosDemoActive: () => true, logosDemoEnabled: () => false }));

import { logosDemoClient } from "./logos-demo-client";

describe("Logos demo client", () => {
  it("uses the exported owner and answers time-window queries across offsets", async () => {
    const { client, user } = await logosDemoClient();
    expect(user.id).toBe("o1");
    // 2026-10-28 in India starts at 2026-10-27T18:30Z, so both current slices fall on that day.
    const { data } = await client.from("current_time_slices").select("id").gte("start_at", "2026-10-28T00:00:00+05:30").lte("start_at", "2026-10-28T23:59:59.999+05:30").order("start_at");
    expect((data as unknown as { id: string }[]).map((row) => row.id)).toEqual(["s2", "s1"]);
    expect((data as unknown as { activity: string }[])[0].activity).toBe("Read, then slept");
  });

  it("joins founder events to the promoted run and their canonical slice", async () => {
    const { client } = await logosDemoClient();
    const { data: run } = await client.from("current_promoted_founder_replay").select("replay_run_id").eq("mode", "founder_v0_1_live").maybeSingle();
    expect(run).toMatchObject({ replay_run_id: "run1", baseline_wellbeing_score: 771 });
    const { data } = await client.from("founder_wellbeing_value_events").select("*").eq("replay_run_id", "run1").gte("canonical_slices.end_at", "2026-10-28T00:00:00+05:30");
    expect(data).toEqual([expect.objectContaining({ id: "e1", delta_w: 0.1, vcperformance_event_amount: null, canonical_slices: expect.objectContaining({ activity: "Walk" }) })]);
  });

  it("keeps superseded rows out of current slices and protects exported rows", async () => {
    const { client } = await logosDemoClient();
    const { data: all } = await client.from("canonical_slices").select("id");
    const { data: current } = await client.from("current_time_slices").select("id");
    expect((all as unknown[]).length).toBe(3);
    expect((current as unknown[]).length).toBe(2);
    expect((await client.from("canonical_slices").update({ status: "x" }).eq("id", "s1")).error).toEqual({ message: "LOGOS_DEMO_EXPORT_READ_ONLY" });
    expect((await client.rpc("validate_canonical_slice")).error).toEqual({ message: "LOGOS_DEMO_UNSUPPORTED:validate_canonical_slice" });
  });

  it("runs a native voice draft through save, lease and confirm into a pending record", async () => {
    const { client, user } = await logosDemoClient();
    const content = { ciphertext: "c", iv: "i".repeat(16), authTag: "t".repeat(24), keyVersion: 1, digest: "a".repeat(64) };
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await client.rpc("save_native_log_draft", { p_owner: user.id, p_id: id, p_revision: 0, p_content: content, p_lease: null })).data).toBe(1);
    expect((await client.rpc("save_native_log_draft", { p_owner: user.id, p_id: id, p_revision: 0, p_content: content, p_lease: null })).data).toBe(1);
    expect((await client.rpc("save_native_log_draft", { p_owner: user.id, p_id: id, p_revision: 0, p_content: { ...content, digest: "b".repeat(64) }, p_lease: null })).error).toEqual({ message: "REVISION_CONFLICT" });
    const lease = (await client.rpc("reserve_native_log_processing", { p_owner: user.id, p_id: id, p_revision: 1 })).data as string;
    expect((await client.rpc("reserve_native_log_processing", { p_owner: user.id, p_id: id, p_revision: 1 })).error).toEqual({ message: "PROCESSING_BUSY" });
    expect((await client.rpc("save_native_log_draft", { p_owner: user.id, p_id: id, p_revision: 1, p_content: { ...content, digest: "c".repeat(64) }, p_lease: lease })).data).toBe(2);
    const entry = { id: "22222222-2222-4222-8222-222222222222", draft_id: "33333333-3333-4333-8333-333333333333", protocol_link_id: "44444444-4444-4444-8444-444444444444", start_at: "2026-10-29T03:00:00+00:00", end_at: "2026-10-29T03:30:00+00:00", timezone: "Asia/Kolkata", activity: "Spoke into Value Log", wellbeing_node: "Thought", slice_type: "non_performance", community: "house_of_bros" };
    const receipt = await client.rpc("confirm_native_log", { p_owner: user.id, p_id: id, p_revision: 2, p_digest: "c".repeat(64), p_mode: "pilot", p_entries: [entry], p_narrative: content, p_confirmation: "Approved", p_receipt: { kind: "validation_pending", timezone: "Asia/Kolkata" } });
    expect(receipt.data).toMatchObject({ kind: "validation_pending", intakeId: expect.any(String) });
    const { data: pending } = await client.from("canonical_slices").select("id").eq("status", "validation_pending");
    expect(pending).toEqual([expect.objectContaining({ id: entry.id, activity: "Spoke into Value Log" })]);
    const { data: draft } = await client.from("native_log_drafts").select("*").eq("id", id).maybeSingle();
    expect(draft).toMatchObject({ status: "submitted", revision: 3 });
  });
});
