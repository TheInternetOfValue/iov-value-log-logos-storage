const words: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirty: "30",
  fifteen: "15",
  forty: "40",
  twenty: "20",
  fortyfive: "45",
  एक: "1",
  दो: "2",
  तीन: "3",
  चार: "4",
  पाँच: "5",
  छह: "6",
  सात: "7",
  आठ: "8",
  नौ: "9",
  दस: "10",
  ग्यारह: "11",
  बारह: "12",
  तीस: "30",
  ஒன்று: "1",
  இரண்டு: "2",
  மூன்று: "3",
  நான்கு: "4",
  ஐந்து: "5",
  ஆறு: "6",
  ஏழு: "7",
  எட்டு: "8",
  ஒன்பது: "9",
  பத்து: "10",
  முப்பது: "30",
};
export function normalizeSpokenNumbers(input: string) {
  let value = input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x966))
    .replace(/[௦-௯]/g, (c) => String(c.charCodeAt(0) - 0xbe6));
  for (const [word, number] of Object.entries(words))
    value = value.replace(
      new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "gu"),
      number,
    );
  return value
    .replace(/\ba\.m\.?/g, "am")
    .replace(/\bp\.m\.?/g, "pm")
    .replace(/(\d{1,2})\s+(30|15|45)(?=\s*(am|pm))/g, "$1:$2");
}
export function groundedClockMinutes(source: string) {
  const text = normalizeSpokenNumbers(source),
    clocks = new Set<number>();
  for (const m of text.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/g)) {
    const h = Number(m[1]);
    if (h >= 1 && h <= 12)
      clocks.add(
        ((h % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2] || 0),
      );
  }
  for (const m of text.matchAll(
    /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm))/g,
  ))
    clocks.add(Number(m[1]) * 60 + Number(m[2]));
  // A nearby explicit period qualifies this clock only, not every number in a mixed-language narrative.
  for (const m of text.matchAll(
    /(?:morning|सुबह|காலை|evening|afternoon|रात|शाम|மாலை|இரவு)\s*(?:at\s*)?(\d{1,2})(?::([0-5]\d))?/gu,
  )) {
    const h = Number(m[1]);
    if (h >= 1 && h <= 12)
      clocks.add(
        ((h % 12) +
          (/evening|afternoon|रात|शाम|மாலை|இரவு/.test(m[0]) ? 12 : 0)) *
          60 +
          Number(m[2] || 0),
      );
  }
  for (const m of text.matchAll(
    /\b(\d{1,2})(?::([0-5]\d))?\s*(?:in the )?(morning|evening|afternoon)\b/g,
  )) {
    const h = Number(m[1]);
    if (h >= 1 && h <= 12)
      clocks.add(
        ((h % 12) + (m[3] === "morning" ? 0 : 12)) * 60 + Number(m[2] || 0),
      );
  }
  for(const m of text.matchAll(/(morning|सुबह|காலை|evening|afternoon|शाम|மாலை)\s*(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(?:बजे|மணி)?\s*(?:to|until|से|முதல்)\s*(\d{1,2})(?::([0-5]\d))?/gu)){
    const period=/evening|afternoon|शाम|மாலை/.test(m[1])?12:0;
    for(const [h,min] of [[Number(m[2]),Number(m[3]||0)],[Number(m[4]),Number(m[5]||0)]])if(h>=1&&h<=12)clocks.add((h%12+period)*60+min);
  }
  if (/\bnoon\b/.test(text)) clocks.add(720);
  if (/\bmidnight\b/.test(text)) clocks.add(0);
  return clocks;
}
export function groundedLocalTime(
  value: string | null,
  source: string,
  date: string,
  overnight: boolean,
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value))
    return "";
  const normalized = value.slice(0, 16),
    minutes =
      Number(normalized.slice(11, 13)) * 60 + Number(normalized.slice(14, 16));
  if (minutes < 0 || minutes >= 1440) return "";
  const next = new Date(Date.parse(date + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  if (
    normalized.slice(0, 10) !== date &&
    !source.includes(normalized.slice(0, 10)) &&
    !(overnight && normalized.slice(0, 10) === next)
  )
    return "";
  const clocks = groundedClockMinutes(source);
  if (clocks.has(minutes)) return normalized;
  const text = normalizeSpokenNumbers(source);
  const duration: number[] = [],
    hourSpans: Array<[number, number]> = [];
  for (const m of text.matchAll(
    /\b(\d{1,2})\s*(?:hours?|hrs?|घंटे?|மணி)(?:\s*(?:and\s*)?(\d{1,2})\s*(?:minutes?|mins?|मिनट|நிமிட))?/g,
  )) {
    duration.push(Number(m[1]) * 60 + Number(m[2] || 0));
    hourSpans.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(/\b(\d{1,3})\s*(?:minutes?|mins?|मिनट|நிமிட)/g))
    if (!hourSpans.some(([start, end]) => m.index! >= start && m.index! < end))
      duration.push(Number(m[1]));
  if (/half an? hour|half hour/.test(text)) duration.push(30);
  if (/(?<!half )\ban hour\b|एक घंटा/u.test(text)) duration.push(60);
  if (
    duration.some(
      (d) =>
        d > 0 &&
        d <= 600 &&
        [...clocks].some((start) => (start + d) % 1440 === minutes),
    )
  )
    return normalized;
  return "";
}
