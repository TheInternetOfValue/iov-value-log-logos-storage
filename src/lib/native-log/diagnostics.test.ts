import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: () => ({ from: (table: string) => ({ insert: (row: unknown) => insert(table, row) }) }) }));
import { providerFacts, recordNativeDiagnostic, safeErrorCode, waveLevel } from "./diagnostics";
import { ProviderContractError } from "./provider-contract";
import { pcmWave } from "./audio";
const owner = "11111111-1111-4111-8111-111111111111",
  draft = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("content-free native diagnostics", () => {
  it("appends a whitelisted stage outcome to the owner's audit ledger", async () => {
    await recordNativeDiagnostic(owner, draft, { stage: "structure", outcome: "failed", code: "PROVIDER_RESPONSE", provider: { stage: "proposal_quote" }, counts: { activitiesBefore: 0 } });
    expect(insert).toHaveBeenCalledWith("audit_events", {
      owner_id: owner, actor_type: "system", event_type: "native_log_diagnostic", entity_type: "native_log", entity_id: draft,
      metadata: { stage: "structure", outcome: "failed", code: "PROVIDER_RESPONSE", provider: { stage: "proposal_quote" }, counts: { activitiesBefore: 0 } },
    });
  });
  it("refuses free text, extra fields and foreign identifiers instead of storing them", async () => {
    await recordNativeDiagnostic(owner, draft, { stage: "structure", outcome: "failed", code: "I walked to the market" } as never);
    await recordNativeDiagnostic(owner, draft, { stage: "structure", outcome: "ok", transcript: "private words" } as never);
    await recordNativeDiagnostic("not-an-owner", draft, { stage: "structure", outcome: "ok" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("never interrupts the person's flow when the ledger is unavailable", async () => {
    insert.mockRejectedValue(new Error("network"));
    await expect(recordNativeDiagnostic(owner, draft, { stage: "submission", outcome: "ok" })).resolves.toBeUndefined();
    insert.mockResolvedValue({ error: { message: "denied" } });
    await expect(recordNativeDiagnostic(owner, draft, { stage: "submission", outcome: "ok" })).resolves.toBeUndefined();
  });
  it("keeps only the provider contract stage, never a response body", () => {
    const facts = providerFacts(new ProviderContractError({ stage: "proposal_quote", finishReason: "stop", issues: [{ code: "invalid_type", path: "activities.0" }], completionTokens: 120 }));
    expect(facts).toEqual({ stage: "proposal_quote", finishReason: "stop", issueCodes: ["invalid_type"], completionTokens: 120 });
    expect(providerFacts(new Error("PRIVATE_BODY"))).toBeUndefined();
    expect(safeErrorCode(new Error("NO_TRANSCRIBED_WORDS"))).toBe("NO_TRANSCRIBED_WORDS");
    expect(safeErrorCode(new Error("Sarvam said: I walked"))).toBe("UNAVAILABLE");
  });
  it("separates silent capture from speech-level audio", async () => {
    const silent = Buffer.from(await pcmWave([new Float32Array(16000)], 16000, 0, 1).arrayBuffer());
    const tone = new Float32Array(16000).map((_, i) => 0.5 * Math.sin(i / 5));
    const spoken = Buffer.from(await pcmWave([tone], 16000, 0, 1).arrayBuffer());
    expect(waveLevel(silent)).toEqual({ peakDbfs: -120, rmsDbfs: -120 });
    expect(waveLevel(spoken).peakDbfs).toBeGreaterThan(-10);
    expect(waveLevel(spoken).rmsDbfs).toBeGreaterThan(-20);
  });
});
