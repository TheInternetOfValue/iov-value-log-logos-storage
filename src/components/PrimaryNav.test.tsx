import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/day",
}));

import { PrimaryNav } from "./PrimaryNav";

describe("PrimaryNav review attention", () => {
  it("shows the exact human-decision count when it is available", () => {
    const html = renderToStaticMarkup(<PrimaryNav reviewCount={3} />);
    expect(html).toContain("3 review decisions");
    expect(html).toContain('class="nav-attention "');
  });

  it("does not silently present an unavailable count as zero", () => {
    const html = renderToStaticMarkup(<PrimaryNav reviewUnavailable />);
    expect(html).toContain("Review decision count is temporarily unavailable");
    expect(html).toContain("…");
  });

  it("keeps a genuinely empty human-decision queue quiet", () => {
    const html = renderToStaticMarkup(<PrimaryNav />);
    expect(html).not.toContain("nav-attention");
  });
});
