import { describe, expect, it } from "vitest";
import { buildDailyMovementProjection, type DailyMovementEvent } from "./day-movement";

const event = (id: string, change: string, preW: string, postW: string, settledAt: string): DailyMovementEvent => ({
  id, change, preW, postW, settledAt,
});

describe("daily movement projection", () => {
  it("orders settlements and sums exact fixed12 changes", () => {
    const projection = buildDailyMovementProjection({ events: [
      event("later", "-0.000400000000", "771.110400000000", "771.110000000000", "2026-08-01T18:00:00+05:30"),
      event("earlier", "0.000400000000", "771.110000000000", "771.110400000000", "2026-08-01T08:00:00+05:30"),
    ] });
    expect(projection.status).toBe("completed");
    expect(projection.netW).toBe("0.000000000000");
    expect(projection.openingW).toBe("771.110000000000");
    expect(projection.closingW).toBe("771.110000000000");
    expect(projection.events.map((item) => item.id)).toEqual(["earlier", "later"]);
    expect(projection.settlements.map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("distinguishes calculated zero from pending and unavailable", () => {
    const zero = buildDailyMovementProjection({ events: [
      event("zero", "0.000000000000", "771.110000000000", "771.110000000000", "2026-08-01T08:00:00+05:30"),
    ] });
    expect(zero.status).toBe("zero");
    expect(zero.events).toHaveLength(1);
    expect(zero.settlements).toHaveLength(0);
    expect(buildDailyMovementProjection({ events: [], pending: true }).status).toBe("pending");
    expect(buildDailyMovementProjection({ events: [] }).status).toBe("unavailable");
  });

  it("keeps overnight movement on its actual settlement timestamp", () => {
    const projection = buildDailyMovementProjection({ events: [
      event("overnight", "0.000400000000", "771.110000000000", "771.110400000000", "2026-08-02T06:00:00+05:30"),
    ] });
    expect(projection.settlements[0].settledAt).toBe("2026-08-02T06:00:00+05:30");
  });
});
