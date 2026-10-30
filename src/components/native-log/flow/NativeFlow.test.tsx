import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../native-log.css", () => ({}));
vi.mock("./flow.css", () => ({}));
import { NativeLog } from "../NativeLog";
import { CheckScreen, type Correction } from "./FlowView";
import { emptyNativeActivity, newNativeDraft } from "@/lib/native-log/draft";

const owner = "a".repeat(64), id = "10000000-0000-4000-8000-000000000001";
const render = (initial: Parameters<typeof NativeLog>[0]["initial"], extra: Partial<Parameters<typeof NativeLog>[0]> = {}) => renderToStaticMarkup(
  <NativeLog ownerScope={owner} mode="personal" date="2026-10-28" today="2026-10-28" timezone="Asia/Kolkata" binding="synthetic-binding"
    writing processing initial={initial} savedDrafts={[]} {...extra} />,
);
const table = () => ({
  ...newNativeDraft(owner, "2026-10-28", "Asia/Kolkata", "personal"),
  transcript: "Woke up at 6am. Walked from 7 to 7:45 am. Had breakfast.",
  activities: [
    { ...emptyNativeActivity(id), activity: "Walk", startLocal: "2026-10-28T07:00", endLocal: "2026-10-28T07:45", node: "Physiology" as const },
    { ...emptyNativeActivity("20000000-0000-4000-8000-000000000002"), activity: "Breakfast", node: "Physiology" as const },
    { ...emptyNativeActivity("30000000-0000-4000-8000-000000000003"), activity: "Some work", timePrecision: "relative" as const, timeLabel: "After lunch" },
  ],
});

describe("member logging flow", () => {
  it("starts with a single voice action", () => {
    const html = render(null);
    expect(html).toContain("Walk back through your day");
    expect(html).toContain("Wednesday 28 October");
    expect(html).toContain("Start speaking");
    expect(html).not.toContain("Submit Value Log");
    expect(html).toContain("Type instead");
    expect(html).not.toContain("native-readback");
  });
  it("shows missing times honestly, keeps the person's time words, and offers typed fixes on each row", () => {
    const shared = render({ id, revision: 3, document: table(), receipt: null }, { sharedDay: true });
    expect(shared).toContain("3 activities · 2 need a time");
    expect(shared).toContain("7:00–7:45 am");
    expect(shared).toContain("After lunch");
    expect(shared).toContain('aria-label="Add a time for Breakfast"');
    expect(shared).toContain('aria-label="Add a time for Some work"');
    expect(shared).toContain('aria-label="Fix Walk"');
    expect(shared).toContain("Add something that’s missing");
    expect(shared).not.toContain("Speak a correction");
    expect(shared).not.toContain("Read only");
    expect(shared).toContain("Anything without a time is saved as a note on your day.");
    expect(shared).not.toContain("will be saved as");
    expect(shared).toContain("No reading yet");
    const private_ = render({ id, revision: 3, document: table(), receipt: null }, { sharedDay: false });
    expect(private_).toContain("Anything without a time waits in Insights until you add one.");
  });
  it("opens a typed fix under the chosen row without the page-wide saving overlay", () => {
    const correction = (target: string): Correction => ({ target, text: "", sending: false, disabled: false, onOpen: vi.fn(), onChange: vi.fn(), onSend: vi.fn(), onCancel: vi.fn() });
    const fix = renderToStaticMarkup(<CheckScreen draft={table()} sharedDay correction={correction(id)} />);
    expect(fix).toContain("What should change about Walk?");
    expect(fix).toContain("Wrong time");
    expect(fix).toContain("Didn’t happen");
    // A form submit otherwise triggers NavigationFeedback's overlay, which never clears without navigation.
    expect(fix).toContain('data-inline-feedback="true"');
    const time = renderToStaticMarkup(<CheckScreen draft={table()} sharedDay correction={correction("20000000-0000-4000-8000-000000000002")} />);
    expect(time).toContain("When did Breakfast happen?");
    expect(time).not.toContain("Wrong time");
    const added = renderToStaticMarkup(<CheckScreen draft={table()} sharedDay correction={correction("new")} />);
    expect(added).toContain("What else happened, and roughly when?");
    expect(added).not.toContain("Add something that’s missing");
  });
  it("says when proposed rows were left out and points to adding them", () => {
    const one = render({ id, revision: 3, document: table(), receipt: null, unmatchedRows: 1 }, { sharedDay: true });
    expect(one).toContain("We couldn’t place one thing you said, so it isn’t in the table.");
    expect(one).toContain("Add what’s missing");
    const many = renderToStaticMarkup(<CheckScreen draft={table()} sharedDay unmatched={{ count: 2, onAdd: vi.fn(), onDismiss: vi.fn() }}
      correction={{ target: null, text: "", sending: false, disabled: false, onOpen: vi.fn(), onChange: vi.fn(), onSend: vi.fn(), onCancel: vi.fn() }} />);
    expect(many).toContain("We couldn’t place 2 things you said, so they aren’t in the table.");
    expect(render({ id, revision: 3, document: table(), receipt: null }, { sharedDay: true })).not.toContain("couldn’t place");
  });
  it("tells the truth on the receipt", () => {
    const html = render({ id, revision: 4, document: table(), receipt: { kind: "unassessed", ids: [], dates: ["2026-10-28"], count: 3, timezone: "Asia/Kolkata", dayIndexVersion: 1 } }, { sharedDay: true });
    expect(html).toContain("Saved to your day");
    expect(html).toContain("3 activities saved · 1 on your day · 2 untimed notes");
    expect(html).toContain(`/day?date=2026-10-28&amp;added=${id}`);
    const waiting = render({ id, revision: 4, document: table(), receipt: { kind: "capture_review_pending", ids: [], dates: ["2026-10-28"], count: 3, timezone: "Asia/Kolkata" } });
    expect(waiting).toContain("Saved — waiting in Insights");
    expect(waiting).not.toContain("Saved to your day");
  });
  it("keeps the founder pilot on its existing screen", () => {
    expect(render(null, { mode: "pilot" })).not.toContain("Walk back through your day");
  });
});
