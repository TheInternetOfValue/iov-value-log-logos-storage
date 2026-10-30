import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewDays } from "./ReviewDays";

describe("ReviewDays", () => {
  it("marks the selected day and links to earlier days and the full queue", () => {
    const html = renderToStaticMarkup(<ReviewDays selected="2026-10-26" today="2026-10-28" />);
    expect(html).toContain('href="/review?date=2026-10-26"');
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('href="/review?date=2026-10-19"');
    expect(html).toContain('href="/review?date=2026-10-28"');
    expect(html).toContain('href="/review"');
  });
});
