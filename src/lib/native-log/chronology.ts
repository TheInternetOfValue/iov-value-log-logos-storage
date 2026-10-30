import { normalizeSpokenNumbers } from "./grounding";
import type { NativeActivity, NativeDraft } from "./draft";

type Clock = { text: string; minute: number; index: number; explicit: boolean };
function clocks(source: string, morning: boolean): Clock[] {
  const text = normalizeSpokenNumbers(source);
  return [...text.matchAll(/\b(\d{1,2}):([0-5]\d)\s*(am|pm)?\b/g)].flatMap(
    (m) => {
      const hour = Number(m[1]);
      if (hour > 23 || (m[3] && (hour < 1 || hour > 12))) return [];
      const explicit = Boolean(m[3]) || hour > 12 || m[1].startsWith("0");
      // Do not silently choose a period for a genuinely ambiguous bare clock.
      if (!explicit && !morning) return [];
      const h = m[3] ? (hour % 12) + (m[3] === "pm" ? 12 : 0) : hour;
      return [
        {
          text: m[0].trim(),
          minute: h * 60 + Number(m[2]),
          index: m.index!,
          explicit,
        },
      ];
    },
  );
}
function morningAccount(text: string) {
  const value = normalizeSpokenNumbers(text);
  return (
    !/\b(?:pm|evening|afternoon|last night|yesterday)\b/.test(value) &&
    (/morning|सुबह|காலை/u.test(value) ||
      /\b(?:now|it'?s|its)\s+(?:it'?s\s+)?(?:[01]?\d)(?::[0-5]\d)?\s*am\b/.test(
        value,
      ))
  );
}
const local = (date: string, minute: number) =>
  `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Exact local source window, including only an immediately adjoining stated boundary.
 * Never search another person's log, model text, or a review question for evidence.
 */
export function activityTimeSource(transcript: string, quote: string) {
  const at = transcript.indexOf(quote);
  if (at < 0) return quote;
  const before = transcript.slice(Math.max(0, at - 100), at);
  const boundary =
    before.match(
      /(?:till|until|back\s+(?:at|around)|finished\s+at|ended\s+at)\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?[, .\n]*$/i,
    )?.[0] ?? "";
  const period = morningAccount(transcript) ? "\nMorning account." : "";
  return boundary + quote + period;
}

/** Recover explicit clocks and proposed adjoining boundaries; never invent a duration.
 * Approximate/inherited boundaries stay labelled for the person's readback approval.
 * Existing/manual answers and cross-midnight episodes are left intact.
 */
export function reconcileNarrativeTimes(draft: NativeDraft): NativeDraft {
  if (!draft.activities.length) return draft;
  const morning = morningAccount(draft.transcript);
  const positions = draft.activities
    .map((a, i) => ({ a, i, at: draft.transcript.indexOf(a.sourceQuote) }))
    .filter((x) => x.a.sourceQuote && x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const activities = draft.activities.map((a) => ({ ...a }));
  let previous: { a: NativeActivity; end: number } | null = null;
  for (const { a: old, i, at } of positions) {
    const a = activities[i];
    if (a.sleepRest) {
      previous = null;
      continue;
    }
    const source = old.sourceQuote,
      found = clocks(source, morning),
      prefix = normalizeSpokenNumbers(source);
    const manual = new Set(old.manualFields ?? []);
    let note = old.timeNote ?? "";
    const start =
      /^\s*(?:(?:after|from|at|between)\s+(?:uh\s*)?)(\d{1,2}:\d{2})(?:\s*[,–-]\s*(\d{1,2}:\d{2}))?/i.exec(
        prefix,
      );
    if (start?.[2] && !manual.has("startLocal") && !a.startFromReply)
      note = `Approximate start: ${start[1]}–${start[2]}.`;
    if (!a.startLocal && !manual.has("startLocal") && start) {
      const chosen = found.find((c) => c.text.startsWith(start[2] || start[1]));
      if (chosen) {
        a.startLocal = local(draft.date, chosen.minute);
        if (start[2]) note = `Approximate start: ${start[1]}–${start[2]}.`;
      }
    }
    const ending =
      /(?:till|until|back\s+(?:at|around)|finished\s+(?:at|around)|ended\s+(?:at|around)|to)\s+(?:like\s+|about\s+)?(\d{1,2}:\d{2})/gi;
    const endMatches = [...prefix.matchAll(ending)];
    const endMatch = endMatches.at(-1);
    if (!a.endLocal && !manual.has("endLocal") && endMatch) {
      const chosen = found.find((c) => c.text.startsWith(endMatch[1]));
      if (chosen) a.endLocal = local(draft.date, chosen.minute);
    }
    // A stated 'now' can close an explicitly just-completed activity, not an ongoing one.
    if (
      !a.endLocal &&
      !manual.has("endLocal") &&
      /just (?:got over|finished|ended)/i.test(source)
    ) {
      const now =
        /\bnow\s+(?:it'?s\s+)?(\d{1,2}:\d{2})\s*(?:a\.?m\.?|p\.?m\.?)/i.exec(
          source,
        );
      const chosen = now && found.find((c) => c.text.startsWith(now[1]));
      if (chosen) a.endLocal = local(draft.date, chosen.minute);
    }
    const startMinute = a.startLocal
      ? Number(a.startLocal.slice(11, 13)) * 60 +
        Number(a.startLocal.slice(14, 16))
      : -1;
    const statedStart = clocks(source, true).some(
      (c) => c.minute % 720 === startMinute % 720,
    );
    const proposedJoin = Boolean(
      previous?.a.endLocal &&
        a.startLocal === previous.a.endLocal &&
        !statedStart,
    );
    if (
      (!a.startLocal ||
        a.inheritedStartFrom === previous?.a.id ||
        proposedJoin) &&
      !a.startFromReply &&
      !manual.has("startLocal") &&
      previous?.a.endLocal &&
      a.endLocal
    ) {
      const gap = draft.transcript.slice(previous.end, at);
      if (
        at >= previous.end &&
        /^[\s,.;]*(?:and|then|next)?[\s,.;]*$/i.test(gap) &&
        !/\b(?:later|break|gap|eventually|after a while|after some time)\b/i.test(
          source.slice(0, 100),
        ) &&
        previous.a.endLocal < a.endLocal
      ) {
        a.startLocal = previous.a.endLocal;
        a.inheritedStartFrom = previous.a.id;
        note =
          "Start follows the previous activity in your account; confirm this proposed boundary.";
      }
    }
    if (
      (a.startLocal || a.endLocal) &&
      /\b(?:around|about|like|approximately|roughly)\s+\d/i.test(prefix)
    )
      note = note
        ? /approximate/i.test(note)
          ? note
          : `${note} Some times were approximate.`
        : "Times were reported approximately.";
    if (note) a.timeNote = note;
    previous = { a, end: at + source.length };
  }
  if (JSON.stringify(activities) === JSON.stringify(draft.activities))
    return draft;
  return {
    ...draft,
    activities,
    revision: draft.revision + 1,
    reviewedRevision: null,
  };
}
