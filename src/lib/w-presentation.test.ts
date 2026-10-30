import { describe, expect, it } from "vitest";
import { formatWMovement, formatWState, sumW } from "./w-presentation";

describe("W presentation", () => {
  it("keeps small positive, negative, zero, sub-threshold, and null movement distinct", () => {
    expect(formatWMovement("0.000400000000")).toBe("+0.0004 W");
    expect(formatWMovement("-0.000400000000")).toBe("-0.0004 W");
    expect(formatWMovement("0.000000000000")).toBe("0.0000 W");
    expect(formatWMovement("0.000040000000")).toBe("+<0.0001 W");
    expect(formatWMovement("-0.000040000000")).toBe("-<0.0001 W");
    expect(formatWMovement(null)).toBe("No completed W movement");
  });

  it("uses round-half-even at four presentation decimals", () => {
    expect(formatWState("1.234450000000")).toBe("1.2344 W");
    expect(formatWState("1.234550000000")).toBe("1.2346 W");
  });

  it("sums exact fixed12 movement before presentation", () => {
    expect(sumW(["0.000400000000", "0.000400000000", "-0.000100000000"])).toBe("0.000700000000");
    expect(formatWMovement(sumW(["0.000400000000", "0.000400000000", "-0.000100000000"]))).toBe("+0.0007 W");
  });
});
