import { expect, it } from "vitest";
import { submissionState } from "./submission-state";
const ready = { busy: false, writing: true, confirming: true, beforePilot: false, voiceActive: false, unsentWords: false };
it("keeps a finished correction submittable and explains every blocked guard", () => {
  expect(submissionState(ready).disabled).toBe(false);
  for (const blocked of [
    { busy: true }, { captureIssue: "Recording incomplete" },
    { processingIssue: "Completeness check failed" }, { timelineIssue: "Two activities overlap" },
    { writing: false }, { confirming: false }, { beforePilot: true },
    { voiceActive: true }, { unsentWords: true },
  ]) {
    const result = submissionState({ ...ready, ...blocked });
    expect(result.disabled).toBe(true);
    expect(result.message.length).toBeGreaterThan(10);
  }
  expect(submissionState({ ...ready, processingIssue: "Completeness check failed" }).message).toBe("Completeness check failed");
  expect(submissionState({ ...ready, voiceActive: true }).message).toContain("retry");
  expect(submissionState({ ...ready, voiceActive: true, voiceRecording: true }).message).toContain("Finish");
});
