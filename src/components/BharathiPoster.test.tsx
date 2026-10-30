import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BharathiPoster portrait treatment", () => {
  it("uses the supplied portrait as an identified editorial image", () => {
    const component = readFileSync(join(process.cwd(), "src/components/BharathiPoster.tsx"), "utf8");

    expect(component).toContain('src="/brand/bharathiyar-portrait.png"');
    expect(component).toContain('alt="Subramania Bharati"');
    expect(component).toContain('lang="ta">சுப்பிரமணிய பாரதி');
    expect(existsSync(join(process.cwd(), "public/brand/bharathiyar-portrait.png"))).toBe(true);
  });

  it("keeps the portrait treatment monochrome and geometry-stable", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain("filter:grayscale(1) contrast(1.16) sepia(.12)");
    expect(css).toContain(".bharathi-poster-portrait figure::after");
    expect(css).toContain("grid-template-columns:104px minmax(0,1fr)");
  });
});
