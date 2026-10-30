import { describe, expect, it } from "vitest";
import {
  fixed12Divide,
  fixed12DurationHours,
  fixed12Format,
  fixed12FromDecimal,
  fixed12Multiply,
  timestampToEpochMicroseconds,
} from "./fixed12";

describe("fixed12", () => {
  it("rounds positive and negative ties to the nearest even final digit", () => {
    expect(fixed12Format(fixed12FromDecimal("1.0000000000005"))).toBe("1.000000000000");
    expect(fixed12Format(fixed12FromDecimal("1.0000000000015"))).toBe("1.000000000002");
    expect(fixed12Format(fixed12FromDecimal("-1.0000000000005"))).toBe("-1.000000000000");
    expect(fixed12Format(fixed12FromDecimal("-1.0000000000015"))).toBe("-1.000000000002");
  });

  it("uses half-even multiplication and division without floating point", () => {
    const one = fixed12FromDecimal("1");
    const six = fixed12FromDecimal("6");
    expect(fixed12Format(fixed12Divide(one, six))).toBe("0.166666666667");
    expect(fixed12Format(fixed12Multiply(fixed12FromDecimal("-2.5"), fixed12FromDecimal("4"))))
      .toBe("-10.000000000000");
  });

  it("retains database timestamp microseconds and derives exact duration", () => {
    const genesis = "2026-07-28T11:11:34.890018Z";
    expect(timestampToEpochMicroseconds("2026-07-28T11:11:34.890019Z") - timestampToEpochMicroseconds(genesis)).toBe(1n);
    expect(fixed12Format(fixed12DurationHours(
      "2026-07-28T11:11:34.890018Z",
      "2026-07-28T12:41:34.890018Z",
    ))).toBe("1.500000000000");
  });

  it("guards the database fixed12 numeric envelope", () => {
    expect(() => fixed12FromDecimal("1000000000000000000.000000000000")).toThrow("FIXED12_OVERFLOW");
  });

  it("represents very long validated durations without floating-point loss", () => {
    expect(fixed12Format(fixed12DurationHours(
      "2026-01-01T00:00:00.000000Z",
      "2126-01-01T00:00:00.000000Z",
    ))).toBe("876576.000000000000");
  });
});
