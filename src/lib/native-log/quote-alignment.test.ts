import { describe, expect, it } from "vitest";
import { alignQuote } from "./quote-alignment";

const transcript = "I woke up at six. Then I went horse riding from 7am to 8am. After that I had breakfast. शाम को मैं दोस्तों से मिला।";
describe("quotation alignment", () => {
  it("returns the person's exact words for an exact, paraphrased or re-punctuated quotation", () => {
    expect(alignQuote("After that I had breakfast.", [transcript])).toBe("After that I had breakfast.");
    expect(alignQuote("Then I went for horse riding from 7am to 8am", [transcript])).toBe("Then I went horse riding from 7am to 8am.");
    expect(alignQuote("after that, I had breakfast", [transcript])).toBe("After that I had breakfast.");
    expect(alignQuote("शाम को, मैं दोस्तों से मिला", [transcript])).toBe("शाम को मैं दोस्तों से मिला।");
  });
  it("never accepts words the person did not say, or a one-word near-match", () => {
    expect(alignQuote("I ran a marathon this morning", [transcript])).toBeNull();
    expect(alignQuote("Breakfasts", [transcript])).toBeNull();
    expect(alignQuote("", [transcript])).toBeNull();
  });
  it("searches follow-up answers as separate sources", () => {
    expect(alignQuote("also lunch at one", [transcript, "Also, lunch at one."])).toBe("Also, lunch at one.");
  });
});
