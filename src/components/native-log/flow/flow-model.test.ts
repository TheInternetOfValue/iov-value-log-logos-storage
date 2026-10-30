import { describe, expect, it } from "vitest";
import { emptyNativeActivity, newNativeDraft, type NativeActivity } from "@/lib/native-log/draft";
import { NativeRequestError } from "@/lib/native-log/upload";
import { SilenceWatch, peakDbfs } from "@/lib/native-log/silence";
import { checkSummary, doneSummary, failureCopy, failureFrom, flowScreen, spokenTimeText, timeText } from "./flow-model";

const activity = (id: string, changes: Partial<NativeActivity> = {}) => ({ ...emptyNativeActivity(id), activity: "Walk", node: "Physiology" as const, ...changes });
const ids = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000003"];
const day = (activities: NativeActivity[]) => ({ ...newNativeDraft("a".repeat(64), "2026-10-28", "Asia/Kolkata", "personal"), transcript: "words", activities });
const base = { receipt: null, capturing: false, busy: false, failure: null, activities: 0, transcript: false };

describe("flow screens", () => {
  it("follows the person's journey, with any capture or work taking the screen", () => {
    expect(flowScreen(base)).toBe("start");
    expect(flowScreen({ ...base, capturing: true, activities: 3 })).toBe("recording");
    expect(flowScreen({ ...base, busy: true })).toBe("processing");
    expect(flowScreen({ ...base, failure: { kind: "offline", stage: "sending" } })).toBe("failed");
    expect(flowScreen({ ...base, activities: 3 })).toBe("check");
    expect(flowScreen({ ...base, transcript: true })).toBe("failed");
    expect(flowScreen({ ...base, activities: 3, failure: { kind: "unknown", stage: "submit" } })).toBe("check");
    expect(flowScreen({ ...base, capturing: true, receipt: { kind: "unassessed", ids: [], dates: [], count: 1, timezone: "UTC" } })).toBe("done");
  });
  it("names the real cause of a failure", () => {
    expect(failureFrom(new TypeError("Failed to fetch"), "sending").kind).toBe("offline");
    expect(failureFrom(new NativeRequestError("x", 408, "NETWORK_TIMEOUT"), "sending").kind).toBe("offline");
    expect(failureFrom(new NativeRequestError("x", 503, "PROVIDER_TIMEOUT"), "sending").kind).toBe("speech_service");
    expect(failureFrom(new NativeRequestError("x", 503, "PROVIDER_TIMEOUT"), "table").kind).toBe("table_step");
    expect(failureFrom(new NativeRequestError("x", 401, "UNAUTHORIZED"), "table").kind).toBe("signin");
    expect(failureFrom(new Error("anything"), "sending", false).kind).toBe("offline");
    expect(failureFrom(new DOMException("timed out", "TimeoutError"), "sending").kind).toBe("offline");
    expect(failureFrom(new DOMException("timed out", "TimeoutError"), "table").kind).toBe("table_step");
    expect(failureCopy({ kind: "offline", stage: "sending", part: { failed: 2, total: 3 } }).reason)
      .toBe("This phone lost its internet connection while sending part 2 of 3. 1 part was sent.");
  });
});

describe("table and receipt copy", () => {
  it("shows stated, rough and missing times honestly", () => {
    expect(timeText(activity(ids[0], { startLocal: "2026-10-28T07:00", endLocal: "2026-10-28T07:45" }))).toBe("7:00–7:45 am");
    expect(timeText(activity(ids[0], { startLocal: "2026-10-28T10:00", endLocal: "2026-10-28T13:00" }))).toBe("10:00 am–1:00 pm");
    expect(timeText(activity(ids[0], { startLocal: "2026-10-28T08:30", timePrecision: "period_inferred" }))).toBe("~8:30 am");
    expect(spokenTimeText(activity(ids[0], { startLocal: "2026-10-28T08:30", timePrecision: "approximate" }))).toBe("around 8:30 am");
    expect(spokenTimeText(activity(ids[0], { timePrecision: "relative", timeLabel: "after lunch" }))).toBe("after lunch");
    expect(timeText(activity(ids[0]))).toBeNull();
  });
  it("counts what needs a time, with correct singular and plural", () => {
    const timed = activity(ids[0], { startLocal: "2026-10-28T07:00", endLocal: "2026-10-28T07:45" });
    expect(checkSummary(day([timed, activity(ids[1])]))).toBe("2 activities · 1 needs a time");
    expect(checkSummary(day([timed, activity(ids[1]), activity(ids[2])]))).toBe("3 activities · 2 need a time");
    expect(checkSummary(day([timed]))).toBe("1 activity · all have a time");
  });
  it("tells the truth about where the log went", () => {
    const draft = day([activity(ids[0], { startLocal: "2026-10-28T07:00", endLocal: "2026-10-28T07:45" }), activity(ids[1])]);
    const shared = doneSummary({ kind: "unassessed", ids: [], dates: ["2026-10-28"], count: 2, timezone: "Asia/Kolkata", dayIndexVersion: 1 }, draft, ids[2]);
    expect([shared.heading, shared.line, shared.href]).toEqual(["Saved to your day", "2 activities saved · 1 on your day · 1 untimed note", `/day?date=2026-10-28&added=${ids[2]}`]);
    const waiting = doneSummary({ kind: "capture_review_pending", ids: [], dates: ["2026-10-28"], count: 2, timezone: "UTC" }, draft, ids[2]);
    expect([waiting.heading, waiting.href]).toEqual(["Saved — waiting in Insights", "/review"]);
    const single = doneSummary({ kind: "unassessed", ids: [], dates: ["2026-10-28"], count: 1, timezone: "UTC", dayIndexVersion: 1 }, day([activity(ids[0], { startLocal: "2026-10-28T07:00", endLocal: "2026-10-28T07:45" })]), ids[2]);
    expect(single.line).toBe("1 activity saved · 1 on your day");
  });
});

describe("silence warning", () => {
  it("warns only after a long near-silent stretch and clears when sound returns", () => {
    const watch = new SilenceWatch(0);
    expect(watch.observe(-60, 4000).silent).toBe(false);
    expect(watch.observe(-60, 8000)).toMatchObject({ silent: true, changed: true });
    expect(watch.observe(-60, 9000)).toMatchObject({ silent: true, changed: false });
    expect(watch.observe(-20, 9500)).toMatchObject({ silent: false, recovered: true });
    expect(watch.observe(-60, 12000).silent).toBe(false);
  });
  it("measures peak level", () => {
    expect(peakDbfs(new Float32Array(10))).toBe(-120);
    expect(peakDbfs(Float32Array.from([0, 0.5, -0.1]))).toBe(-6);
  });
});
