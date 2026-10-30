import { describe, expect, it } from "vitest";
import { parseCinematicReelScript } from "@/lib/cinematic-reel-script";

describe("cinematic reel script parser", () => {
  it("parses supported time-coded reel sections", () => {
    const result = parseCinematicReelScript("### **0:00–0:05 — Hook**\n\n**Shot / edit:** Papers on a desk.\n\n**Narrator:** The launch begins.\n\n**On-screen text:** Make it count.\n\n---\n\n### **0:45–0:50 — Final beat**\n\n**Voiceover:** The tab remains open.");
    expect(result).toMatchObject({ kind: "structured", beats: [{ timecode: "0:00–0:05", shotEdit: "Papers on a desk.", narrator: "The launch begins." }, { finalBeat: true, narrator: "The tab remains open." }] });
  });
  it("preserves malformed and older scripts as safe readable text", () => {
    const script = "<img src=x onerror=alert(1)>\nAn older reel.";
    expect(parseCinematicReelScript(script)).toEqual({ kind: "fallback", text: script });
  });
});
