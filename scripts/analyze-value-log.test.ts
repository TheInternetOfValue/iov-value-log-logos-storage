import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAnalysisPayload, outputPathIsSafe, parseAnalysisArgs } from "./analyze-value-log";

describe("analysis command", () => {
  it("parses defaults and explicit options", () => {
    expect(parseAnalysisArgs([], "2026-07-26")).toEqual({ asOf: "2026-07-26", period: "both", format: "text" });
    expect(parseAnalysisArgs(["--as-of", "2026-07-20", "--period", "week", "--format", "json", "--output", "/tmp/report.json"], "2026-07-26")).toEqual({ asOf: "2026-07-20", period: "week", format: "json", output: "/tmp/report.json" });
    expect(() => parseAnalysisArgs(["--period", "quarter"], "2026-07-26")).toThrow("week, month, or both");
  });

  it("extracts the payload from nested JSON and NDJSON", () => {
    const payload = { schema_version: "value-log-analysis-input-v1", verification: { canonical_did_count: 1, member_count: 1 }, slices: [], w_events: [], credit_events: [] };
    expect(extractAnalysisPayload(JSON.stringify({ result: [{ value_log_analysis: payload }] }))).toEqual(payload);
    expect(extractAnalysisPayload(`${JSON.stringify({ level: "info" })}\n${JSON.stringify({ value_log_analysis: JSON.stringify(payload) })}`)).toEqual(payload);
  });

  it("allows external or ignored private output and rejects repository-visible output", () => {
    const repo = resolve(import.meta.dirname, "..");
    expect(outputPathIsSafe("/tmp/value-log-private.json", repo)).toBe(true);
    expect(outputPathIsSafe(resolve(repo, ".next/private-report.json"), repo)).toBe(true);
    expect(outputPathIsSafe(resolve(repo, "private-report.json"), repo)).toBe(false);
    expect(outputPathIsSafe(resolve(repo, ".git/private-report.json"), repo)).toBe(false);
  });
});
