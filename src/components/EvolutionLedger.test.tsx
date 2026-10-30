import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chapters, milestones } from "@/lib/changelog-data";
import { EvolutionLedger } from "./EvolutionLedger";

describe("EvolutionLedger", () => {
  it("keeps every historical milestone inside five readable chapters", () => {
    const html = renderToStaticMarkup(<EvolutionLedger />);
    expect(milestones).toHaveLength(66);
    expect(chapters).toHaveLength(5);
    for (const milestone of milestones) expect(html).toContain(milestone.title);
    for (const chapter of chapters) expect(html).toContain(`href="#${chapter.id}"`);
  });

  it("opens only the latest folio and preserves native disclosure and archive access", () => {
    const html = renderToStaticMarkup(<EvolutionLedger />);
    expect((html.match(/<details[^>]* open=""/g) ?? [])).toHaveLength(1);
    expect((html.match(/name="evolution-ledger"/g) ?? [])).toHaveLength(milestones.length);
    expect(html).toContain('href="/changelog/archive#evolution-gallery-title"');
    expect(html).toContain("Visual proof");
  });
});
