// Deliberately synthetic provider acceptance. Never reads a member, transcript or salary.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  emptyNativeActivity,
  newNativeDraft,
  type NativeDraft,
  type NativeActivity,
} from "../src/lib/native-log/draft";
import {
  structureWithSarvam,
  SARVAM_CHAT_MODEL,
  structuredSarvam,
} from "../src/lib/native-log/sarvam-core";
import {
  REVIEW_INSTRUCTIONS,
  REVIEW_BATCH_INSTRUCTIONS,
  checkedReviewBatch,
  blindReviewInputs,
  reviewBatchSchema,
} from "../src/lib/cohort/review-worker";
import {
  safeProviderFailure,
  type ProviderDiagnostic,
} from "../src/lib/native-log/provider-contract";
import { SARVAM_CHAT_PROFILE } from "../src/lib/native-log/chat-profile";
import type { CohortActivity } from "../src/lib/cohort/policy";
import { checkNarrationCoverage } from "../src/lib/native-log/coverage";
// Pin the exact instruction, interpretation and review sources loaded by this process.
const qualitySources = [
  "./cohort-quality.ts",
  "../src/lib/native-log/instructions.ts",
  "../src/lib/native-log/sarvam-core.ts",
  "../src/lib/native-log/chat-profile.ts",
  "../src/lib/native-log/draft.ts",
  "../src/lib/native-log/time.ts",
  "../src/lib/native-log/grounding.ts",
  "../src/lib/native-log/vague-time.ts",
  "../src/lib/native-log/quote-alignment.ts",
  "../src/lib/native-log/chronology.ts",
  "../src/lib/native-log/temporal.ts",
  "../src/lib/native-log/provider-contract.ts",
  "../src/lib/cohort/policy.ts",
  "../src/lib/cohort/review-worker.ts",
  "../src/lib/cohort/sources.ts",
  "../src/lib/native-log/coverage.ts",
  "../src/lib/field-station/dated-policy.ts",
  "../src/lib/field-station/ids.ts",
  "./cohort-quality-runner.mjs",
];
const sourceSha256 = createHash("sha256")
  .update(
    qualitySources
      .map(
        (path) =>
          `${path}\n${readFileSync(new URL(path, import.meta.url), "utf8")}`,
      )
      .join("\n"),
  )
  .digest("hex");
const day = "2026-10-25",
  first = "10000000-0000-4000-8000-000000000001",
  second = "10000000-0000-4000-8000-000000000002";
const draft = (text: string): NativeDraft => ({
  ...newNativeDraft("a".repeat(64), day, "Asia/Kolkata", "personal"),
  transcript: text,
  cohort: {
    policyId: "field-station-assumed-700-v1",
    houseId: "house_of_sis",
    workCommunities: [
      { id: "gfe", name: "Growth Flow Engineering" },
      { id: "iov", name: "Internet of Value Research Foundation" },
    ],
  },
});
const cases = [
  {
    id: "english-duration-neutral",
    text: "I walked from eight am for thirty minutes. I directly noticed no change in how I felt.",
    node: "Physiology",
    start: "08:00",
    end: "08:30",
    effect: "neutral",
  },
  {
    id: "work-context",
    text: "From nine am to ten am I wrote the GFE landing page for Earning. I directly noticed no wellbeing change.",
    node: "Performance",
    start: "09:00",
    end: "10:00",
    community: "gfe",
    lane: "Earning",
    effect: "neutral",
  },
  {
    id: "hindi-mixed",
    text: "सुबह आठ बजे से नौ बजे तक मैं टहला। I noticed no change in my wellbeing.",
    node: "Physiology",
    start: "08:00",
    end: "09:00",
    effect: "neutral",
  },
  {
    id: "tamil-mixed",
    text: "காலை எட்டு மணி முதல் ஒன்பது மணி வரை நடந்தேன். I noticed no change in my wellbeing.",
    node: "Physiology",
    start: "08:00",
    end: "09:00",
    effect: "neutral",
  },
  {
    id: "unknown-time",
    text: "After breakfast I worked on a website for a while.",
    node: "Performance",
    start: "",
    end: "",
    community: "",
  },
  {
    id: "future-plan",
    text: "Tomorrow I plan to walk from eight am to nine am.",
    empty: true,
  },
  {
    id: "overnight-sleep",
    text: "I slept from ten pm to six am the next morning. I noticed slightly better bodily recovery after sleeping.",
    node: "Physiology",
    start: "22:00",
    end: "06:00",
    overnight: true,
  },
  {
    id: "feeling-not-biochemistry",
    text: "From eight am to eight thirty am I sat feeling joy. I felt a little more joyful. I did not measure any hormones.",
    node: "Feeling",
    start: "08:00",
    end: "08:30",
  },
] as const;
const observedActivities = (items: NativeActivity[]) => ({
  count: items.length,
  activities: items.slice(0, 3).map((a) => ({
    node: a.node,
    start: a.startLocal,
    end: a.endLocal,
    community: a.community,
    lane: a.lane,
    direction: a.direction,
    intensity: a.intensity,
    confidence: a.confidence,
  })),
});
function longCoverageScenario() {
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const expected = Array.from({ length: 18 }, (_, i) => ({
    start: clock(360 + i * 30),
    end: clock(380 + i * 30),
  }));
  const text = expected
    .map(
      (time, i) =>
        `I walked route ${i + 1} from ${time.start} to ${time.end}. The footpath was narrow, the field was green and there were trees nearby. The route was quiet, with sandy ground and a few shaded stretches beside the field. The light was soft, the weather was mild and the boundary of the field was visible from the path. These are details of this walk.`,
    )
    .join(" ");
  return { expected, source: { ...draft(text), date: "2026-10-26" } };
}
/** Fixed subset for investigating the retained long-log failure; never a full gate pass. */
export async function probeLongCoverageQuality() {
  const { expected, source } = longCoverageScenario(),
    started = Date.now();
  try {
    const activities = await structureWithSarvam(
      source,
      AbortSignal.timeout(125000),
    );
    const proof = await checkNarrationCoverage(
      { ...source, activities },
      AbortSignal.timeout(125000),
    );
    const missingTimes = expected.filter(
      (time) =>
        !activities.some(
          (a) =>
            a.startLocal === `2026-10-26T${time.start}` &&
            a.endLocal === `2026-10-26T${time.end}`,
        ),
    );
    return {
      syntheticOnly: true,
      partial: true,
      passed: false,
      sourceSha256,
      sourceTextSha256: createHash("sha256")
        .update(source.transcript)
        .digest("hex"),
      model: SARVAM_CHAT_MODEL,
      cases: [
        {
          id: "coverage-long-eighteen-activities",
          passed:
            activities.length === 18 &&
            !missingTimes.length &&
            activities.every((a) => !a.direction) &&
            proof.complete,
          durationMs: Date.now() - started,
          observed: {
            count: activities.length,
            missingTimes,
            coverage: proof,
            activities: activities.map((a) => ({
              node: a.node,
              start: a.startLocal,
              end: a.endLocal,
              direction: a.direction,
              intensity: a.intensity,
              confidence: a.confidence,
              quoteOccurrences:
                source.transcript.split(a.sourceQuote).length - 1,
            })),
          },
        },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      syntheticOnly: true,
      partial: true,
      passed: false,
      sourceSha256,
      model: SARVAM_CHAT_MODEL,
      cases: [
        {
          id: "coverage-long-eighteen-activities",
          passed: false,
          ...safeProviderFailure(error),
        },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}
export async function runCohortQuality() {
  const results: Array<{
    id: string;
    passed: boolean;
    durationMs: number;
    reason?: string;
    code?: string;
    diagnostic?: ProviderDiagnostic;
    observed?:
      | ReturnType<typeof observedActivities>
      | { outcome: string; hasQuestion: boolean; evidenceCount: number };
  }> = [];
  for (const c of cases) {
    const start = Date.now();
    let observed: ReturnType<typeof observedActivities> | undefined;
    try {
      const items = await structureWithSarvam(
        draft(c.text),
        AbortSignal.timeout(125000),
      );
      observed = observedActivities(items);
      if ("empty" in c) {
        if (items.length) throw new Error("future_activity_created");
      } else {
        const a = items[0];
        if (items.length !== 1 || !a || a.node !== c.node)
          throw new Error("primary_node");
        if (a.startLocal !== (c.start ? day + "T" + c.start : ""))
          throw new Error("start_time");
        if (
          a.endLocal !==
          (c.end ? ("overnight" in c ? "2026-10-26" : day) + "T" + c.end : "")
        )
          throw new Error("finish_time");
        if ("community" in c && a.community !== c.community)
          throw new Error("membership");
        if ("lane" in c && a.lane !== c.lane) throw new Error("route");
        if ("effect" in c && a.direction !== c.effect)
          throw new Error("reported_effect");
      }
      results.push({ id: c.id, passed: true, durationMs: Date.now() - start });
    } catch (error) {
      results.push({
        id: c.id,
        passed: false,
        durationMs: Date.now() - start,
        ...safeProviderFailure(error),
        observed,
        reason:
          error instanceof Error &&
          [
            "primary_node",
            "future_activity_created",
            "start_time",
            "finish_time",
            "membership",
            "route",
            "reported_effect",
          ].includes(error.message)
            ? error.message
            : "provider_or_contract",
      });
    }
  }
  const existing = {
    ...emptyNativeActivity(first),
    activity: "Synthetic walk",
    sourceQuote: "I walked from eight am to eight thirty am.",
    startLocal: day + "T08:00",
    endLocal: day + "T08:30",
    node: "Physiology" as const,
    direction: "neutral" as const,
    confidence: "observed" as const,
    community: "house_of_sis",
  };
  const d = {
    ...draft(existing.sourceQuote),
    activities: [
      existing,
      {
        ...existing,
        id: second,
        activity: "Other approved activity",
        startLocal: day + "T10:00",
        endLocal: day + "T10:30",
      },
    ],
    conversation: [
      {
        id: second,
        activityId: first,
        text: "Correction: I finished the walk at nine am.",
      },
    ],
  };
  let started = Date.now();
  let correctedObserved: ReturnType<typeof observedActivities> | undefined;
  try {
    const items = await structureWithSarvam(d, AbortSignal.timeout(125000));
    correctedObserved = observedActivities(items);
    if (
      items.length !== 2 ||
      items[0].id !== first ||
      items[0].endLocal !== day + "T09:00" ||
      JSON.stringify(items[1]) !== JSON.stringify(d.activities[1])
    )
      throw new Error("targeted_correction");
    results.push({
      id: "targeted-correction",
      passed: true,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    results.push({
      id: "targeted-correction",
      passed: false,
      durationMs: Date.now() - started,
      reason: "provider_or_contract",
      observed: correctedObserved,
      ...safeProviderFailure(error),
    });
  }
  // Flowing narration and corrections are the actual product contract, beyond isolated examples.
  const spoken =
    "After 7:15, 7:30 I met friends and we walked around a farm, visited the nearby school and exercised, then came back around 8:30. Then I talked to a neighbour until 9:30, then had breakfast till 10:30. Then attended the daily standup, which just got over. Now it's 11:30 am.";
  let readback: NativeActivity[] = [];
  async function conversationCase(id: string, operation: () => Promise<void>) {
    const started = Date.now();
    try {
      await operation();
      results.push({ id, passed: true, durationMs: Date.now() - started });
    } catch (error) {
      results.push({
        id,
        passed: false,
        durationMs: Date.now() - started,
        ...safeProviderFailure(error),
        reason:
          error instanceof Error && error.message.startsWith("readback_")
            ? error.message
            : "provider_or_contract",
      });
    }
  }
  await conversationCase("flowing-morning-readback", async () => {
    readback = await structureWithSarvam(
      draft(spoken),
      AbortSignal.timeout(125000),
    );
    if (readback.length !== 4) throw new Error("readback_row_count");
    const expected = [
      ["07:30", "08:30"],
      ["08:30", "09:30"],
      ["09:30", "10:30"],
      ["10:30", "11:30"],
    ];
    for (const [i, a] of readback.entries()) {
      if (
        a.startLocal !== day + "T" + expected[i][0] ||
        a.endLocal !== day + "T" + expected[i][1]
      )
        throw new Error("readback_time");
      if (a.direction || a.intensity || a.confidence)
        throw new Error("readback_invented_effect");
    }
    if (!readback[0].timeNote?.includes("7:15"))
      throw new Error("readback_approximation_hidden");
  });
  await conversationCase("global-voice-correction", async () => {
    if (readback.length !== 4) throw new Error("readback_initial_required");
    const next = {
      ...draft(spoken),
      activities: readback,
      conversation: [
        {
          id: first,
          activityId: null,
          text: "The walk actually ended at nine am.",
        },
      ],
    };
    const result = await structureWithSarvam(next, AbortSignal.timeout(125000));
    if (
      result.length !== 4 ||
      result[0].id !== readback[0].id ||
      result[0].endLocal !== day + "T09:00" ||
      result[1].startLocal !== day + "T09:00"
    )
      throw new Error("readback_correction");
    if (JSON.stringify(result.slice(2)) !== JSON.stringify(readback.slice(2)))
      throw new Error("readback_unrelated_changed");
  });
  await conversationCase("global-voice-addition", async () => {
    if (readback.length !== 4) throw new Error("readback_initial_required");
    const text =
      "Also add lunch: I ate from one pm to one thirty pm. I noticed no wellbeing change.";
    const result = await structureWithSarvam(
      {
        ...draft(spoken),
        activities: readback,
        conversation: [{ id: second, activityId: null, text }],
      },
      AbortSignal.timeout(125000),
    );
    if (
      result.length !== 5 ||
      JSON.stringify(result.slice(0, 4)) !== JSON.stringify(readback)
    )
      throw new Error("readback_addition_changed_existing");
    if (
      result[4].startLocal !== day + "T13:00" ||
      result[4].endLocal !== day + "T13:30" ||
      result[4].direction !== "neutral"
    )
      throw new Error("readback_addition");
  });
  // Rough spoken times (value-log-conversation-v6): forward chronology, relative words, and no guessing.
  await conversationCase("vague-forward-morning", async () => {
    const rows = await structureWithSarvam(draft("Woke up at 6am. Then I walked seven to eight. Had breakfast around 8:30."), AbortSignal.timeout(125000));
    if (rows.length !== 3) throw new Error("readback_row_count");
    if (rows[1].startLocal !== day + "T07:00" || rows[1].endLocal !== day + "T08:00") throw new Error("readback_rough_time");
    if (rows[2].startLocal !== day + "T08:30") throw new Error("readback_approximate_time");
  });
  await conversationCase("vague-relative-part-of-day", async () => {
    const rows = await structureWithSarvam(draft("After lunch I did some work. In the evening I met friends."), AbortSignal.timeout(125000));
    if (rows.length !== 2) throw new Error("readback_row_count");
    if (rows.some((a) => a.startLocal || a.endLocal)) throw new Error("readback_invented_clock");
    if (rows.some((a) => !a.timeLabel)) throw new Error("readback_time_words_lost");
  });
  await conversationCase("vague-lone-bare-clock", async () => {
    const rows = await structureWithSarvam(draft("I went to the meeting at 2:30."), AbortSignal.timeout(125000));
    if (rows.length !== 1) throw new Error("readback_row_count");
    if (rows[0].startLocal) throw new Error("readback_guessed_half_of_day");
  });
  const activity: CohortActivity = {
    id: first,
    occurrenceId: first,
    start: day + "T02:30:00Z",
    end: day + "T03:00:00Z",
    activity: "Synthetic walk",
    quote: "I walked from eight am to eight thirty am and noticed no change.",
    node: "Physiology",
    context: "",
    proof: "",
    direction: "neutral",
    intensity: null,
    confidence: "observed",
    sleepRest: false,
    workCommunity: null,
    lane: null,
  };
  for (const [id, node, expected] of [
    ["review-reported-neutral", "Physiology", "reviewed"],
    ["review-node-contradiction", "Emotion", "clarification"],
  ] as const) {
    started = Date.now();
    let reviewObserved:
      | { outcome: string; hasQuestion: boolean; evidenceCount: number }
      | undefined;
    try {
      const inputs = [{ recordId: first, activity: { ...activity, node } }];
      const output = await structuredSarvam(
        "cohort_review_batch",
        reviewBatchSchema,
        REVIEW_INSTRUCTIONS +
          " Return exactly one decision per supplied recordId.",
        {
          records: blindReviewInputs(inputs),
          timezone: "Asia/Kolkata",
          wellbecomingCommunity: "house_of_sis",
          memberships: [],
          policy: "field-station-assumed-700-v1",
        },
        AbortSignal.timeout(125000),
      );
      const decision = checkedReviewBatch(output, inputs).get(first);
      if (decision)
        reviewObserved = {
          outcome: decision.outcome,
          hasQuestion: Boolean(decision.question),
          evidenceCount: decision.evidenceQuotes.length,
        };
      if (
        !decision ||
        (expected === "reviewed"
          ? decision.outcome !== "reviewed"
          : !["clarification", "escalated"].includes(decision.outcome))
      )
        throw new Error("review_quality");
      results.push({ id, passed: true, durationMs: Date.now() - started });
    } catch (error) {
      results.push({
        id,
        passed: false,
        durationMs: Date.now() - started,
        reason: "provider_or_contract",
        observed: reviewObserved,
        ...safeProviderFailure(error),
      });
    }
  }
  await conversationCase("coverage-long-eighteen-activities", async () => {
    const { expected, source } = longCoverageScenario();
    const activities = await structureWithSarvam(
      source,
      AbortSignal.timeout(125000),
    );
    if (
      activities.length !== 18 ||
      expected.some(
        (time) =>
          !activities.some(
            (a) =>
              a.startLocal === `2026-10-26T${time.start}` &&
              a.endLocal === `2026-10-26T${time.end}`,
          ),
      ) ||
      activities.some((a) => a.direction)
    )
      throw new Error(
        `readback_long_rows_${activities.length}_missing_times_${expected.filter((time) => !activities.some((a) => a.startLocal === `2026-10-26T${time.start}` && a.endLocal === `2026-10-26T${time.end}`)).length}_unsupported_effects_${activities.filter((a) => a.direction).length}`,
      );
    const proof = await checkNarrationCoverage(
      { ...source, activities },
      AbortSignal.timeout(125000),
    );
    if (!proof.complete)
      throw new Error(
        `readback_long_omission_${JSON.stringify(proof.diagnostics)}`,
      );
  });
  await conversationCase(
    "coverage-detects-missing-work-and-breakfast",
    async () => {
      const source = {
        ...draft(
          "I walked from 8am to 8:30am. I ate breakfast from 9am to 9:30am. I worked on a paid website project from 10am to noon.",
        ),
        date: "2026-10-26",
      };
      const item = {
        ...emptyNativeActivity(first),
        activity: "Walked",
        sourceQuote: "I walked from 8am to 8:30am.",
        node: "Physiology" as const,
        startLocal: "2026-10-26T08:00",
        endLocal: "2026-10-26T08:30",
      };
      const proof = await checkNarrationCoverage(
        { ...source, activities: [item] },
        AbortSignal.timeout(125000),
      );
      if (proof.complete || proof.missing < 1)
        throw new Error("missing_activities_accepted");
    },
  );
  await conversationCase("review-long-source-reference", async () => {
    const text =
      "This synthetic reply preserves the earlier approved details. ".repeat(
        200,
      ) +
      "The walk ended at 8:30am and I explicitly report no physical effect.";
    const sourceId = "10000000-0000-4000-8000-000000000003";
    const inputs = [
      {
        recordId: first,
        activity: {
          ...activity,
          start: "2026-10-26T02:30:00Z",
          end: "2026-10-26T03:00:00Z",
          quote: "I walked from eight am to eight thirty am.",
          sourceReference: {
            draftId: sourceId,
            documentRevision: 7,
            replyIds: [second],
          },
          followUpAnswers: [{ id: second, text }],
        },
      },
    ];
    const output = await structuredSarvam(
      "cohort_review_batch",
      reviewBatchSchema,
      REVIEW_BATCH_INSTRUCTIONS,
      {
        records: blindReviewInputs(inputs),
        sources: [
          { id: sourceId, replies: [{ id: second, activityId: null, text }] },
        ],
        timezone: "Asia/Kolkata",
        wellbecomingCommunity: "house_of_sis",
        memberships: [],
        policy: "field-station-oct26-28-qa-v1",
      },
      AbortSignal.timeout(125000),
    );
    if (checkedReviewBatch(output, inputs).get(first)?.outcome !== "reviewed")
      throw new Error("long_reference_review");
  });
  return {
    syntheticOnly: true,
    sourceSha256,
    model: SARVAM_CHAT_MODEL,
    configuration: SARVAM_CHAT_PROFILE,
    passed: results.every((r) => r.passed),
    cases: results,
    checkedAt: new Date().toISOString(),
  };
}
