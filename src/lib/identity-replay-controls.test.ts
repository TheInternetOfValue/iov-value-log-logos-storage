import { describe, expect, it } from "vitest";
import { moveReplayIndex, swipeReplayIndex } from "./identity-replay-controls";

describe("IdentityReplay controls", () => {
  it("keeps midnight opening state before the first Next action", () => {
    expect(moveReplayIndex(-1, -1, 4)).toBe(-1);
    expect(moveReplayIndex(-1, 1, 4)).toBe(0);
  });

  it("accepts intentional horizontal swipes and ignores vertical or short gestures", () => {
    expect(swipeReplayIndex(-1, -70, 10, 4)).toBe(0);
    expect(swipeReplayIndex(1, 70, 10, 4)).toBe(0);
    expect(swipeReplayIndex(1, -30, 4, 4)).toBe(1);
    expect(swipeReplayIndex(1, -70, 90, 4)).toBe(1);
  });
});
