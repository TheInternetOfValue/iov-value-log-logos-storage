// Trusted server/worker core. A model's quotation is a pointer into the
// person's words, not evidence by itself: it is replaced by the person's exact
// words, or the row is not accepted. One poor quotation never discards others.
import { normalizeSpokenNumbers } from "./grounding";

const tokens = (text: string) =>
  normalizeSpokenNumbers(text)
    .replace(/[^\p{L}\p{M}\p{N}:]+/gu, " ")
    .split(" ")
    .filter((token) => token.length > 1 || /\d/.test(token));

/** Sentence-like spans with their exact positions in the source. */
function spans(source: string) {
  const result: Array<{ start: number; end: number }> = [];
  const pattern = /[^.!?।\n]+[.!?।]*/gu;
  for (const match of source.matchAll(pattern)) {
    const text = match[0];
    const lead = text.length - text.trimStart().length;
    if (text.trim()) result.push({ start: match.index! + lead, end: match.index! + text.trimEnd().length });
  }
  return result;
}

/**
 * Return the person's exact words that this quotation points to: the quotation
 * itself when it is an exact span, otherwise the smallest run of up to three
 * neighbouring sentences in one source containing at least 75% of its words.
 * Two or more meaningful words are required for a non-exact match.
 */
export function alignQuote(quote: string, sources: string[]): string | null {
  const wanted = quote.trim();
  if (!wanted) return null;
  for (const source of sources) if (source.includes(wanted)) return wanted;
  const needed = [...new Set(tokens(wanted))];
  if (needed.length < 2) return null;
  let best: { text: string; coverage: number; length: number } | null = null;
  for (const source of sources) {
    const parts = spans(source);
    for (let first = 0; first < parts.length; first++) {
      for (let last = first; last < Math.min(parts.length, first + 3); last++) {
        const text = source.slice(parts[first].start, parts[last].end);
        const present = new Set(tokens(text));
        const coverage = needed.filter((token) => present.has(token)).length / needed.length;
        if (coverage >= 0.75 && (!best || coverage > best.coverage || (coverage === best.coverage && text.length < best.length)))
          best = { text, coverage, length: text.length };
      }
    }
  }
  return best?.text ?? null;
}
