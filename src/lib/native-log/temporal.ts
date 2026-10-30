/** Only unambiguous future-only English intentions bypass completed-activity interpretation.
 * Mixed, quoted or uncertain accounts continue through normal interpretation and source checks.
 */
export function explicitFutureOnly(input: string) {
  const text = input.normalize("NFKC").trim();
  if (!text || /["“”‘’]/u.test(text)) return false;
  const clauses = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const pastOrMixed =
    /\b(?:yesterday|earlier|already|last\s+(?:night|week|month)|finished|completed|did|went|walked|worked|slept|was|were|had|started|now|but)\b/i;
  const future =
    /^(?:(?:tomorrow|next\s+(?:day|morning|evening|week|month))[, ]+)?(?:I|we)\s+(?:(?:plan|intend|hope|want|expect)\s+to|will|am\s+going\s+to|are\s+going\s+to)\s+[^;.!?]+[.!?]?$/i;
  return (
    clauses.length > 0 &&
    clauses.every((c) => future.test(c) && !pastOrMixed.test(c))
  );
}
