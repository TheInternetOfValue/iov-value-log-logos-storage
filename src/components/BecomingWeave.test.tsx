import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightEvidence } from "./BecomingWeave";
import type { InsightWeaveSeries } from "@/lib/trends";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { BecomingWeave } from "./BecomingWeave";

const series: InsightWeaveSeries = {
  start_date: "2026-07-17", end_date: "2026-07-23", range_days: 7,
  lanes: ["Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance"].map((node) => ({
    node: node as InsightWeaveSeries["lanes"][number]["node"],
    activity_count: node === "Physiology" || node === "Performance" ? 1 : 0,
    logged_minutes: node === "Physiology" ? 60 : node === "Performance" ? 90 : 0,
    w_net: node === "Physiology" ? .02 : 0,
    credits: node === "Performance" ? 120 : 0,
    stitches: node === "Physiology" ? [{ id: "slice-w", activity: "Synthetic rest", node: "Physiology", community: "house_of_bros", start_at: "2026-07-20T08:00:00+05:30", end_at: "2026-07-20T09:00:00+05:30", timezone: "Asia/Kolkata", start_date: "2026-07-20", settlement_date: "2026-07-20", minutes: 60, w_change: .02, credits: null, sao_lane: null, skill_level: null }] : node === "Performance" ? [{ id: "slice-p", activity: "Synthetic research", node: "Performance", community: "iov", start_at: "2026-07-21T10:00:00+05:30", end_at: "2026-07-21T11:30:00+05:30", timezone: "Asia/Kolkata", start_date: "2026-07-21", settlement_date: "2026-07-21", minutes: 90, w_change: null, credits: 120, sao_lane: "Learning", skill_level: "L2" }] : [],
  })),
};
const evidence: InsightEvidence = {
  periodMovement: Array.from({ length: 7 }, (_, index) => {
    const date = `2026-07-${String(17 + index).padStart(2, "0")}`;
    return { id: date, date, label: `${17 + index} Jul`, value: index === 6 ? null : index / 100 };
  }),
  selectedSeries: null,
  days: Array.from({ length: 7 }, (_, index) => {
    const date = `2026-07-${String(17 + index).padStart(2, "0")}`;
    return { date, label: `${17 + index} Jul`, activityCount: index, wValue: index === 6 ? null : index / 100, credits: index * 10 };
  }),
  houseOfBrosW: .02,
  houseOfBrosMinutes: 60,
  iovCredits: 120,
  iovMinutes: 90,
  gfeCredits: 0,
  gfeMinutes: 0,
};

describe("BecomingWeave", () => {
  beforeEach(() => push.mockClear());

  it("renders every primary lane and exact accessible stitch readings", () => {
    const html = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} />);
    expect(html).toContain("Five inner Wellbecoming threads and one separate Performance thread");
    expect(html).toContain("Physiology. Mon, 20 Jul, 8:00 am–9:00 am. Synthetic rest. +0.0200 W.");
    expect(html).toContain("Performance. Tue, 21 Jul, 10:00 am–11:30 am. Synthetic research. 120 credits.");
    expect(html.match(/weave-lane tone-/g)).toHaveLength(6);
    expect(html).toContain("weave-mobile-trace");
    expect(html).toContain("Capability and contribution");
    expect(html).toContain("Mon, 20 Jul. +0.0300 W completed movement. Open movement reading.");
    expect(html).not.toContain("Movement over the period");
  });

  it("uses the light identity locator without claiming a Skills write", () => {
    const wellbeing = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} selectedNode="Physiology" />);
    const performance = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} selectedNode="Performance" />);
    expect(wellbeing).toContain("Identity state ring highlighted as identity context");
    expect(wellbeing).toContain("not a canonical Wellbeing Identity write");
    expect(performance).toContain("Skills ring highlighted as identity context");
    expect(performance).toContain("does not update this ring in this release");
  });

  it("names missing settled measures without treating an empty period as failure", () => {
    const empty: InsightWeaveSeries = { ...series, lanes: series.lanes.map((lane) => ({ ...lane, activity_count: 0, logged_minutes: 0, w_net: 0, credits: 0, stitches: [] })) };
    const emptyHtml = renderToStaticMarkup(<BecomingWeave evidence={{ ...evidence, periodMovement: evidence.periodMovement.map((value) => ({ ...value, value: null })) }} series={empty} />);
    const recordedWithoutResults: InsightWeaveSeries = { ...series, lanes: series.lanes.map((lane) => ({ ...lane, w_net: 0, credits: 0, stitches: lane.stitches.map((stitch) => ({ ...stitch, w_change: null, credits: null })) })) };
    const pendingHtml = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={recordedWithoutResults} />);
    expect(emptyHtml).toContain("No recorded life in this range");
    expect(emptyHtml).toContain("No Performance contribution appears in this range");
    expect(pendingHtml).toContain("No completed W movement appears in this range");
  });

  it("keeps stitch geometry unchanged when a node is pinned", () => {
    const overview = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} />);
    const selected = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} selectedNode="Physiology" />);
    expect(overview.match(/<line class="weave-stitch-line"[^>]+>/g)).toEqual(selected.match(/<line class="weave-stitch-line"[^>]+>/g));
    const lines = overview.match(/<line class="weave-stitch-line"[^>]+>/g) ?? [];
    const halos = overview.match(/<line class="weave-stitch-focus"[^>]+>/g) ?? [];
    expect(halos.map((line) => line.replace("weave-stitch-focus", "weave-stitch-line"))).toEqual(lines);
  });

  it("keeps evidence closed after an ordinary node or date selection", () => {
    const selected = renderToStaticMarkup(<BecomingWeave evidence={evidence} series={series} selectedDate="2026-07-20" selectedNode="Physiology" />);
    expect(selected).not.toContain('class="insight-evidence-layer"');
    expect(selected).not.toContain("<details open");
    expect(selected).toMatch(/aria-pressed="true"[^>]*>Reading/);
    expect(selected).toMatch(/aria-pressed="false"[^>]*>Evidence/);
  });
});
