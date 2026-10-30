export type ReplaySummary = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  from_timestamp: string | null;
  failure_message: string | null;
  affected_count: number;
  heartbeat_at: string | null;
};

/**
 * Only the latest replay can describe current machine work. Migration-closed
 * legacy runs have no restart point and must not appear as actionable errors.
 */
export function actionableReplay(latest: ReplaySummary | null) {
  if (!latest) return null;
  if (latest.status === "running") return latest;
  if (latest.status === "failed" && latest.from_timestamp) return latest;
  return null;
}
