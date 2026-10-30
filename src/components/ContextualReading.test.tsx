import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextualReading } from "./ContextualReading";

describe("ContextualReading", () => {
  it("provides one shared live reading shell with optional footer content", () => {
    const html = renderToStaticMarkup(
      <ContextualReading className="day-annotation" footer={<button type="button">Evidence</button>} label="Living Day reading">
        <h3>Recorded life</h3>
      </ContextualReading>,
    );
    expect(html).toContain('aria-label="Living Day reading"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("contextual-reading day-annotation");
    expect(html).toContain("contextual-reading-footer");
    expect(html).toContain("Recorded life");
    expect(html).toContain("Evidence");
  });
});
