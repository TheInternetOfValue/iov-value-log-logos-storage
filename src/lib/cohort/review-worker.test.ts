import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkedReviewBatch,
  blindReviewInputs,
  reviewSignature,
  verifiedReviewJob,
} from "./review-worker";
import type { CohortActivity } from "./policy";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const activity = (quote: string): CohortActivity => ({
  id,
  occurrenceId: id,
  start: "2026-10-25T08:00:00Z",
  end: "2026-10-25T09:00:00Z",
  activity: quote,
  quote,
  context: "",
  proof: "",
  node: "Physiology",
  direction: "neutral",
  intensity: null,
  confidence: "observed",
  sleepRest: false,
  workCommunity: null,
  lane: null,
});
const decision = (quote: string) => ({
  outcome: "reviewed",
  rationale: "The participant reported and approved this observation.",
  question: "",
  evidenceQuotes: [quote],
});
beforeEach(() =>
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-review-signature-over-thirty-two-characters",
  ),
);
afterEach(() => vi.unstubAllEnvs());
describe("automated review boundaries", () => {
  it("accepts only purpose-signed short-lived owner jobs", () => {
    const now = Date.now(),
      raw = JSON.stringify({ owner: id, expires: now + 60000 });
    expect(verifiedReviewJob(raw, reviewSignature(raw), now).owner).toBe(id);
    expect(() => verifiedReviewJob(raw, "a".repeat(64), now)).toThrow(
      "UNAUTHORIZED",
    );
    expect(() =>
      verifiedReviewJob(raw, reviewSignature(raw), now + 60001),
    ).toThrow("UNAUTHORIZED");
    expect(() =>
      verifiedReviewJob(raw.replace(id, other), reviewSignature(raw), now),
    ).toThrow("UNAUTHORIZED");
  });
  it("requires exactly one decision per supplied record and rejects cross-record evidence", () => {
    const inputs = [
      { recordId: id, activity: activity("I walked.") },
      { recordId: other, activity: activity("I rested.") },
    ];
    expect(
      checkedReviewBatch(
        {
          decisions: [
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: decision("I walked."),
            },
            {
              recordId: other,
              supportedNode: "Physiology",
              decision: decision("I rested."),
            },
          ],
        },
        inputs,
      ).size,
    ).toBe(2);
    expect(() =>
      checkedReviewBatch(
        {
          decisions: [
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: decision("I rested."),
            },
            {
              recordId: other,
              supportedNode: "Physiology",
              decision: decision("I rested."),
            },
          ],
        },
        inputs,
      ),
    ).toThrow("PROVIDER_RESPONSE");
    expect(() =>
      checkedReviewBatch(
        {
          decisions: [
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: decision("I walked."),
            },
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: decision("I walked."),
            },
          ],
        },
        inputs,
      ),
    ).toThrow("PROVIDER_RESPONSE");
  });
  it("cannot mark reviewed without evidence or smuggle changed facts into a decision", () => {
    const inputs = [{ recordId: id, activity: activity("I walked.") }];
    expect(() =>
      checkedReviewBatch(
        {
          decisions: [
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: { ...decision("I walked."), evidenceQuotes: [] },
            },
          ],
        },
        inputs,
      ),
    ).toThrow();
    expect(() =>
      checkedReviewBatch(
        {
          decisions: [
            {
              recordId: id,
              supportedNode: "Physiology",
              decision: { ...decision("I walked."), direction: "positive" },
            },
          ],
        },
        inputs,
      ),
    ).toThrow();
  });
});
it("withholds the selected node and turns an independent mismatch into clarification",()=>{
 const input={recordId:id,activity:{...activity("I walked."),node:"Emotion" as const}};
 expect(blindReviewInputs([input])[0].activity).not.toHaveProperty("node");
 expect(input.activity.node).toBe("Emotion");
 const result=checkedReviewBatch({decisions:[{recordId:id,supportedNode:"Physiology",decision:decision("I walked.")}]},[input]).get(id)!;
 expect(result.outcome).toBe("clarification");expect(result.independentNode).toBe("Physiology");
 expect(result.question).toContain("clarify");expect(input.activity.node).toBe("Emotion");
 const unknown=checkedReviewBatch({decisions:[{recordId:id,supportedNode:null,decision:decision("I walked.")}]},[input]).get(id)!;
 expect(unknown.outcome).toBe("clarification");
});
