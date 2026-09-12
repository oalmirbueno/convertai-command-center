/** Read-only counterpart of operator_expire_stale_runs; never changes persisted status. */
export function operatorRunIsStale(run: {
  status?: unknown; heartbeat_at?: unknown; timeout_seconds?: unknown;
}, now = Date.now()): boolean {
  if (run.status !== 'started' && run.status !== 'progress') return false;
  if (typeof run.heartbeat_at !== 'string') return false;
  const heartbeat = Date.parse(run.heartbeat_at);
  const seconds = Number(run.timeout_seconds);
  return Number.isFinite(heartbeat) && Number.isFinite(seconds) && seconds > 0
    && heartbeat < now - seconds * 1000;
}
