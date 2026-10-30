import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./native-log.css", () => ({}));
vi.mock("./flow/flow.css", () => ({}));
import { NativeLog } from "./NativeLog";
import { emptyNativeActivity, newNativeDraft } from "@/lib/native-log/draft";
it("retains a reviewer question on returning to a correction without approving by viewing it", () => {
  const owner = "a".repeat(64),
    id = "10000000-0000-4000-8000-000000000001";
  const document = {
    ...newNativeDraft(owner, "2026-10-25", "Asia/Kolkata", "personal"),
    correctsRecordId: id,
    reviewQuestion: "Which project was this activity for?",
    transcript: "Synthetic activity",
    activities: [
      { ...emptyNativeActivity(id), activity: "Synthetic activity" },
    ],
  };
  const html = renderToStaticMarkup(
    <NativeLog
      ownerScope={owner}
      mode="personal"
      date={document.date}
      today={document.date}
      timezone={document.timezone}
      binding="synthetic-binding"
      writing
      processing
      initial={{ id, revision: 1, document, receipt: null }}
      savedDrafts={[]}
      embedded
    />,
  );
  // Members use the multi-screen flow: the reviewer's question stays visible on the read-only table.
  expect(html).toContain(document.reviewQuestion);
  expect(html).toContain("flow-table");
  expect(html).toContain("Check your correction");
  expect(html).toContain('aria-label="Fix Synthetic activity"');
  expect(html).not.toContain("Speak a correction");
  expect(html).toContain("Submit Value Log");
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toContain("Check details");
  expect(html).not.toContain("Your log is confirmed.");
});

it("distinguishes a saved correction from submission and never offers a false save retry", () => {
  const owner = "a".repeat(64), id = "10000000-0000-4000-8000-000000000002";
  const document = {
    ...newNativeDraft(owner, "2026-10-26", "Asia/Kolkata", "personal"),
    correctsRecordId: id, transcript: "I walked from 8 to 8:30 in the morning.",
    activities: [{ ...emptyNativeActivity(id), activity: "Walk", startLocal: "2026-10-26T08:00", endLocal: "2026-10-26T08:30", node: "Physiology" as const, direction: "neutral" as const }],
  };
  const render = (processingError?: string) => renderToStaticMarkup(<NativeLog ownerScope={owner} mode="personal" date={document.date} today={document.date} timezone={document.timezone} binding="synthetic-binding" writing processing initial={{id, revision: 5, document, receipt: null, processingError}} savedDrafts={[]} deviceRecovery embedded />);
  const saved = render();
  expect(saved).toContain("Correction saved · not submitted");
  expect(saved).not.toContain("Retry saving");
  const failed = render("OMISSION_REVIEW_REQUIRED");
  expect(failed).toContain("Some narrated activities may be missing");
  expect(failed).toContain("Try preparing again");
  const dock = failed.slice(failed.indexOf('class="flow-dock'));
  expect(dock).toContain("Some narrated activities may be missing");
  expect(dock).toMatch(/<button[^>]*disabled[^>]*>Submit Value Log<\/button>/);
  const stale = render("COVERAGE_CHECK_STALE");
  expect(stale).toContain("Your saved table needs a fresh completeness check");
  expect(stale).not.toContain("Some narrated activities may be missing");
});
