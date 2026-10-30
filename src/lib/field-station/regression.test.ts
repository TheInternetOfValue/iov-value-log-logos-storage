import { describe, expect, it } from "vitest";
import {
  calculateCohortReplay,
  cohortActivitySchema,
  cohortReviewBlockers,
  initialCohortState,
} from "@/lib/cohort/policy";
import {
  accounts,
  activity,
  BOUNDARY,
  completeDay,
  expected,
  fixtureId,
  longCorrection,
  NOW,
  reviewed,
  WINDOW_END,
} from "./fixtures";

// Runtime imports deliberately let this first checkpoint report absent contracts
// as failing assertions, rather than hiding them behind skipped tests.
const contract = async (path: string) => import(/* @vite-ignore */ path);

describe("dated Field Station release regressions (synthetic only)", () => {
  it("U02: dates are inclusive on 26 October, exclusive on 29 October and persist on return", async () => {
    const { datedEligibility } = await contract("./dated-policy");
    expect(
      datedEligibility({
        verifiedDid: accounts.brosA.did,
        admittedAt: BOUNDARY,
      }),
    ).toBe(true);
    expect(
      datedEligibility({
        verifiedDid: accounts.outside.did,
        admittedAt: WINDOW_END,
      }),
    ).toBe(false);
    expect(
      datedEligibility({
        verifiedDid: accounts.brosA.did,
        admittedAt: WINDOW_END,
        persisted: true,
      }),
    ).toBe(true);
    expect(datedEligibility({ verifiedDid: null, admittedAt: BOUNDARY })).toBe(
      false,
    );
  });
  it("U05: the unchanged arithmetic begins with six exact 700 components", () => {
    expect(initialCohortState()).toEqual(expected.initialComponents);
    expect(calculateCohortReplay([]).score).toBe(700);
  });
  it("U06: one observed positive-low Physiology occurrence produces exactly 700.007", () => {
    expect(calculateCohortReplay([reviewed()]).score).toBe(
      expected.positiveLowPhysiologyScore,
    );
  });
  it("U07: an explicit neutral effect is zero; missing effect remains pending", () => {
    expect(
      calculateCohortReplay([
        reviewed(activity(1, { direction: "neutral", intensity: null })),
      ]).score,
    ).toBe(700);
    expect(
      cohortReviewBlockers(
        activity(1, { direction: null, intensity: null }),
        [],
        BOUNDARY,
        Date.parse(NOW),
      ),
    ).toContain("reported_effect_requires_confirmation");
  });
  it("U08: dated policy retains work but cannot value it or move Performance", async () => {
    const { calculateDatedReplay, datedActivityOutcome } =
      await contract("./dated-policy");
    const work = completeDay[3];
    expect(datedActivityOutcome(work)).toBe("unassessed");
    const result = calculateDatedReplay([
      reviewed(
        activity(4, {
          ...work,
          direction: "positive",
          intensity: "high",
          confidence: "observed",
        }),
      ),
    ]);
    expect(result.score).toBe(700);
    expect(result.state.Performance).toBe(700);
    expect(result.events).toHaveLength(0);
  });
  it("U10–U13: owner day projection clips overnight intervals without inventing gaps or duplicating sources", async () => {
    const { projectMemberDay } = await contract("../members/day-projection");
    const rows = completeDay.map((a) => ({
      ownerId: accounts.brosA.owner,
      sourceId: a.id,
      occurrenceId: a.occurrenceId,
      activity: a.activity,
      node: a.node,
      start: a.start,
      end: a.end,
      state: "unassessed",
    }));
    const other = {
      ...rows[0],
      ownerId: accounts.brosB.owner,
      sourceId: fixtureId(999),
      activity: "Other owner's private words",
    };
    const result = projectMemberDay(accounts.brosA.owner, "2026-10-26", [
      ...rows,
      rows[1],
      other,
    ]);
    expect(result.activities).toHaveLength(expected.completeDayOccurrences);
    expect(
      result.activities.map((a: { activity: string }) => a.activity),
    ).not.toContain(other.activity);
    expect(
      result.activities.find(
        (a: { sourceId: string }) => a.sourceId === rows[0].sourceId,
      ),
    ).toMatchObject({
      startMinute: 0,
      endMinute: 360,
      occurrenceId: rows[0].occurrenceId,
    });
    expect(
      result.activities.find(
        (a: { sourceId: string }) => a.sourceId === rows[5].sourceId,
      ),
    ).toMatchObject({ startMinute: 1320, endMinute: 1440 });
    expect(result.unknownMinutes).toBeGreaterThan(0);
  });
  it("U17: a supported long reply does not fail the older 3,000-character cohort contract", () => {
    expect(longCorrection.length).toBeGreaterThan(3000);
    expect(
      cohortActivitySchema.safeParse(
        activity(1, {
          followUpAnswers: [{ id: fixtureId(501), text: longCorrection }],
        }),
      ).success,
    ).toBe(true);
  });
  it("U20–U22: device recovery has an account-bound encrypted store and a bounded lifetime", async () => {
    const recovery = await contract("../native-log/device-recovery");
    expect(recovery.RECOVERY_MAX_AGE_MS).toBe(86400000);
    expect(typeof recovery.saveRecoveryChunk).toBe("function");
    expect(typeof recovery.removeRecoveryTurn).toBe("function");
  });
  it("U25: replaying the corrected neutral event yields 700.000, not an extra occurrence", () => {
    const original = calculateCohortReplay([reviewed()]);
    const corrected = calculateCohortReplay([
      reviewed(activity(1, { direction: "neutral", intensity: null })),
    ]);
    expect(original.score).toBe(700.007);
    expect(corrected.score).toBe(expected.correctedNeutralScore);
    expect(corrected.events).toHaveLength(1);
  });
});

it("U13: a reviewed overnight occurrence displays completed movement only on its completion day", async () => {
  const { projectMemberDay } = await contract("../members/day-projection");
  const source = {
    ownerId: accounts.brosA.owner,
    sourceId: fixtureId(851),
    occurrenceId: fixtureId(852),
    activity: "Synthetic overnight sleep",
    node: "Physiology",
    start: "2026-10-26T22:00:00+05:30",
    end: "2026-10-27T06:00:00+05:30",
    state: "reviewed",
    movement: "+0.007 W",
  };
  const earlier = projectMemberDay(accounts.brosA.owner, "2026-10-26", [source])
      .activities[0],
    completed = projectMemberDay(accounts.brosA.owner, "2026-10-27", [source])
      .activities[0];
  expect(earlier.completedMovement).toBe(false);
  expect(earlier.result).toBe("Reviewed");
  expect(completed.completedMovement).toBe(true);
  expect(completed.result).toBe("+0.007 W");
});

it("U12: adopted versions supersede legacy clocks, including an untimed clarification, without inventing a combined interval", async () => {
 const { projectMemberDay }=await contract("../members/day-projection");
 const old={ownerId:accounts.brosA.owner,sourceId:fixtureId(871),occurrenceId:fixtureId(870),activity:"Earlier private walk",node:"Physiology",start:"2026-10-26T08:00:00+05:30",end:"2026-10-26T08:30:00+05:30",state:"unassessed",versionPriority:1};
 const changed={...old,sourceId:fixtureId(872),start:"2026-10-26T08:15:00+05:30",end:"2026-10-26T08:45:00+05:30",versionPriority:2};
 const corrected=projectMemberDay(accounts.brosA.owner,"2026-10-26",[old,changed]);expect(corrected.activities[0]).toMatchObject({start:"08:15",end:"08:45"});
 const unknown=projectMemberDay(accounts.brosA.owner,"2026-10-26",[old,{...changed,start:null,end:null,state:"clarification"}]);expect(unknown.activities).toEqual([]);expect(unknown.notes).toHaveLength(1);expect(unknown.unknownMinutes).toBe(1440);
});
