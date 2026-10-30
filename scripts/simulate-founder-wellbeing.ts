import {
  calculateFounderPerformanceValue,
  calculateFounderTransition,
  calculateFounderW,
  type FounderState,
} from "../src/lib/founder-wellbeing";

let state: FounderState = { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 930 };
const oneSlice = (id: string, startAt: string, endAt: string) => [{ id, startAt, endAt }];

const initial = calculateFounderW(state);
const gfeValue = calculateFounderPerformanceValue({ state, rate: 500, unit: "USD", slices: oneSlice("gfe-l3", "2026-07-25T09:00:00+05:30", "2026-07-25T10:30:00+05:30") });
const gfeTransition = calculateFounderTransition({ state, component: "Performance", direction: "positive", intensity: "medium" });
state = gfeTransition.stateAfter;

const kickboxing = calculateFounderTransition({ state, component: "Physiology", direction: "positive", intensity: "medium" });
state = kickboxing.stateAfter;

const iovValue = calculateFounderPerformanceValue({ state, rate: 7500, unit: "USD", slices: oneSlice("iov-sm3", "2026-07-25T21:30:00+05:30", "2026-07-25T23:00:00+05:30") });
const iovTransition = calculateFounderTransition({ state, component: "Performance", direction: "positive", intensity: "medium" });

process.stdout.write(`${JSON.stringify({
  policy: "hob-wellbecoming-founder-v0.1",
  initial: { state: { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 930 }, w: initial },
  events: [
    { id: "gfe-earning-l3", value: gfeValue, transition: gfeTransition },
    { id: "kickboxing", vcNonperformance: kickboxing.wAfter, transition: kickboxing },
    { id: "iov-systems-modeling-sm3", value: iovValue, transition: iovTransition },
  ],
  endingState: iovTransition.stateAfter,
  endingW: iovTransition.wAfter,
}, null, 2)}\n`);
