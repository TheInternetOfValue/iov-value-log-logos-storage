import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberDay } from "./MemberDay";

const props = { today: "2026-10-29", initialDate: "2026-10-29", initialEntries: [], initialTotal: 0, initialError: false, binding: "b", writing: true, timezone: "Asia/Kolkata" };

describe("member private notes", () => {
  it("leaves the heading, date and footer to Today when embedded", () => {
    const html = renderToStaticMarkup(<MemberDay {...props} embedded voiceDefault />);
    expect(html).not.toContain("What happened today?");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("Asia/Kolkata");
    expect(html).not.toContain("Validated wellbeing readings");
    expect(html).toContain("Write an activity instead");
  });
  it("keeps the standalone page whole", () => {
    const html = renderToStaticMarkup(<MemberDay {...props} />);
    expect(html).toContain("What happened today?");
    expect(html).toContain('type="date"');
  });
});
