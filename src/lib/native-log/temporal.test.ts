import { expect, it } from "vitest";
import { explicitFutureOnly } from "./temporal";
it("excludes unequivocal future-only intentions while retaining the original writing", () => {
  for (const text of [
    "Tomorrow I plan to walk from eight am to nine am.",
    "I intend to learn swimming.",
    "Next week we will cycle.",
    "I hope to rest. We plan to read.",
  ])
    expect(explicitFutureOnly(text)).toBe(true);
});
it("does not discard completed facts, mixed accounts, quotations or uncertain tense", () => {
  for (const text of [
    "I walked from eight am to nine am.",
    "Tomorrow I plan to walk. I worked yesterday.",
    "Tomorrow I plan to walk but I finished a report earlier.",
    "I will explain what I did yesterday.",
    'He said "Tomorrow I plan to walk" after our run.',
    "I am walking now.",
    "कल सुबह मैं टहला।",
    "",
  ])
    expect(explicitFutureOnly(text)).toBe(false);
});
