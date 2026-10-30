import { describe, expect, it } from "vitest";
import { isReplayStale, REPLAY_STALE_AFTER_MS } from "@/lib/replay-runtime";

describe("replay heartbeat expiry", () => {
  const now = new Date("2026-07-16T00:00:00.000Z").getTime();

  it("keeps a recently heartbeating replay active", () => {
    expect(isReplayStale({ heartbeat_at: new Date(now - REPLAY_STALE_AFTER_MS + 1).toISOString() }, now)).toBe(false);
  });

  it("makes an expired replay safely retriable", () => {
    expect(isReplayStale({ heartbeat_at: new Date(now - REPLAY_STALE_AFTER_MS).toISOString() }, now)).toBe(true);
  });

  it("falls back to start time for older replay rows", () => {
    expect(isReplayStale({ started_at: new Date(now - REPLAY_STALE_AFTER_MS).toISOString() }, now)).toBe(true);
  });
});
