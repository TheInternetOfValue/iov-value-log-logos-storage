import { describe, expect, it } from "vitest";
import { actionableReplay, type ReplaySummary } from "@/lib/replay-status";

function replay(overrides: Partial<ReplaySummary>): ReplaySummary {
  return {
    id: "run-1",
    status: "completed",
    started_at: "2026-07-15T04:00:00Z",
    completed_at: "2026-07-15T04:00:10Z",
    from_timestamp: "2026-07-03T00:00:00Z",
    failure_message: null,
    affected_count: 145,
    heartbeat_at: "2026-07-15T04:00:10Z",
    ...overrides,
  };
}

describe("actionable replay status", () => {
  it("shows the latest running replay", () => {
    expect(actionableReplay(replay({ status: "running", completed_at: null })))?.toMatchObject({ status: "running" });
  });

  it("shows a retriable failed replay", () => {
    expect(actionableReplay(replay({ status: "failed", failure_message: "worker failed" })))?.toMatchObject({ status: "failed" });
  });

  it("hides a completed replay", () => {
    expect(actionableReplay(replay({}))).toBeNull();
  });

  it("hides a migration-closed legacy failure without a restart point", () => {
    expect(actionableReplay(replay({ status: "failed", from_timestamp: null }))).toBeNull();
  });
});
