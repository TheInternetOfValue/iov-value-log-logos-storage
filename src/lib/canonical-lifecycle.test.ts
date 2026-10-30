import { describe, expect, it } from "vitest";
import { canRejectDraft, canRemoveCanonicalDuplicate, replaySliceSelection } from "@/lib/canonical-lifecycle";

describe("duplicate-removal lifecycle gates", () => {
  it("only permits a still-draft record to be rejected and removed", () => {
    expect(canRejectDraft("drafted")).toBe(true);
    expect(canRejectDraft("observer_approved")).toBe(false);
  });

  it("permits canonical duplicate removal before and after calculation", () => {
    expect(canRemoveCanonicalDuplicate("validation_pending")).toBe(true);
    expect(canRemoveCanonicalDuplicate("calculated")).toBe(true);
    expect(canRemoveCanonicalDuplicate("superseded")).toBe(false);
  });
});

describe("duplicate-removal replay selection", () => {
  it("reverses a superseded duplicate and later history, but recalculates only active records", () => {
    expect(replaySliceSelection([
      { id: "duplicate", status: "superseded" },
      { id: "later", status: "calculated" },
      { id: "already-reversed", status: "reversed" },
    ])).toEqual({
      reversalSliceIds: ["duplicate", "later"],
      activeCalculatedSliceIds: ["later"],
    });
  });

  it("has no calculation candidates when a pre-calculation duplicate is removed", () => {
    expect(replaySliceSelection([{ id: "pending-duplicate", status: "superseded" }]))
      .toEqual({ reversalSliceIds: ["pending-duplicate"], activeCalculatedSliceIds: [] });
  });
});
