import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrendsLoading from "./loading";

describe("TrendsLoading", () => {
  it("keeps the final Insights title without flashing the conceptual question", () => {
    const html = renderToStaticMarkup(<TrendsLoading />);

    expect(html).toContain(">Insights<");
    expect(html).not.toContain("Across time");
    expect(html).toContain("Opening the completed record.");
    expect(html).toContain("Where recorded life gathered");
  });
});
