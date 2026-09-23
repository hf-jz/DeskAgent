// ── Bridge reaping policy (pure, no electron/python imports) ──
//
// One live python bridge is ~135 MB resident (measured with `footprint`) and
// bridge processes are the dominant term in DeskApp's footprint, so "how many
// bridges stay alive" is the app's main memory knob. Selection is kept pure so
// it can be unit-tested without spawning anything.
//
// `pinned` = a live bubble window owns this bridge. A standing requirement says
// an open bubble's bridge is never killed by idleness (its next question must
// not pay the 5-15s cold start), so pinned entries are never selected — the
// memory guard may only reclaim background (cron / gen-ui) and spare bridges.

export interface BridgeStat {
  key: string
  /** a task is running or queued — never reaped */
  busy: boolean
  /** epoch ms of creation / adoption / last task */
  lastUsedAt: number
  /** owned by an open bubble window → never reaped */
  pinned?: boolean
}

export interface ReapOptions {
  now: number
  /** reap a non-pinned, non-busy bridge idle longer than this (Infinity = only the budget rule) */
  maxIdleMs: number
  /** hard cap on live bridges; over-budget reaps the least recently used */
  maxLive: number
}

/** Keys that should be disposed to respect the idle + budget policy. */
export function selectReaps(stats: BridgeStat[], opts: ReapOptions): string[] {
  const reap = new Set<string>()
  const candidates = stats.filter((s) => !s.busy && !s.pinned)
  for (const s of candidates) {
    if (opts.now - s.lastUsedAt > opts.maxIdleMs) reap.add(s.key)
  }
  const live = stats.filter((s) => !reap.has(s.key))
  const overflow = live.length - opts.maxLive
  if (overflow > 0) {
    candidates
      .filter((s) => !reap.has(s.key))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
      .slice(0, overflow)
      .forEach((s) => reap.add(s.key))
  }
  return [...reap]
}
