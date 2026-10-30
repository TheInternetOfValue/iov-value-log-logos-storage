/** Shared, browser-safe policy identifiers; these carry no authority. */
export const DATED_POLICY = "field-station-oct26-28-700-v1";
export const DATED_QA_POLICY = "field-station-oct26-28-qa-v1";
export const isDatedPolicy = (id: string) =>
  id === DATED_POLICY || id === DATED_QA_POLICY;
