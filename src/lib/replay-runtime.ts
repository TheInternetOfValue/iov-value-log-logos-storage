export const REPLAY_STALE_AFTER_MS = 5 * 60_000;

export function replayHeartbeatTime(replay: { heartbeat_at?: string | null; started_at?: string | null }) {
  const value = replay.heartbeat_at ?? replay.started_at;
  return value ? new Date(value).getTime() : Number.NaN;
}

export function isReplayStale(
  replay: { heartbeat_at?: string | null; started_at?: string | null },
  now = Date.now(),
) {
  const heartbeat = replayHeartbeatTime(replay);
  return Number.isFinite(heartbeat) && now - heartbeat >= REPLAY_STALE_AFTER_MS;
}
