import { expect, it } from "vitest";
import { groundedLocalTime } from "./grounding";
it("preserves spoken clocks, normalized seconds and explicit durations", () => {
  expect(
    groundedLocalTime(
      "2026-10-26T08:30:00",
      "I walked from eight am for thirty minutes.",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T08:30");
  expect(
    groundedLocalTime(
      "2026-10-26T08:00",
      "सुबह आठ बजे चला",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T08:00");
  expect(
    groundedLocalTime(
      "2026-10-26T08:00",
      "காலை எட்டு மணிக்கு நடந்தேன்",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T08:00");
  expect(
    groundedLocalTime(
      "2026-10-26T08:00",
      "after breakfast",
      "2026-10-26",
      false,
    ),
  ).toBe("");
  expect(
    groundedLocalTime(
      "2026-10-26T08:00",
      "from eight to nine",
      "2026-10-26",
      false,
    ),
  ).toBe("");
});
it("keeps morning/evening separate and supports explicit hour durations", () => {
  expect(
    groundedLocalTime(
      "2026-10-26T20:00",
      "I walked at 08:00pm.",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T20:00");
  expect(
    groundedLocalTime(
      "2026-10-26T08:00",
      "I walked at 08:00pm.",
      "2026-10-26",
      false,
    ),
  ).toBe("");
  expect(
    groundedLocalTime(
      "2026-10-26T06:00",
      "सुबह आठ बजे और शाम छह बजे",
      "2026-10-26",
      false,
    ),
  ).toBe("");
  expect(
    groundedLocalTime(
      "2026-10-26T18:00",
      "सुबह आठ बजे और शाम छह बजे",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T18:00");
  expect(
    groundedLocalTime(
      "2026-10-26T09:30",
      "I worked from eight am for one hour and thirty minutes.",
      "2026-10-26",
      false,
    ),
  ).toBe("2026-10-26T09:30");
  expect(
    groundedLocalTime(
      "2026-10-26T08:30",
      "I worked from eight am for one hour and thirty minutes.",
      "2026-10-26",
      false,
    ),
  ).toBe("");
});

it("rejects invalid local clock components even when arithmetic would alias a supported time",()=>{
 expect(groundedLocalTime("2026-10-26T08:99","I walked at 9:39am.","2026-10-26",false)).toBe("");
 expect(groundedLocalTime("2026-10-26T24:00","I rested at midnight.","2026-10-26",false)).toBe("");
});
