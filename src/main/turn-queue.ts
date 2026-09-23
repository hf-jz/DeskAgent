/**
 * Global turn slots — admission control for agent turns.
 *
 * Every turn that reaches an agent backend can cost a python bridge process
 * (~135MB private footprint, see skill references/memory-management.md) or an
 * external CLI process. The existing per-window check in ipc-handlers only
 * serializes turns inside ONE bubble; nothing stopped five bubbles (plus cron
 * and the scheduler) from spawning five bridges at once, which is the actual
 * path to the "app wedges on memory" symptom the memory guard can only react
 * to. This is the proactive half: at most MAX_TURNS turns execute at a time,
 * the rest wait in one FIFO. Reaping idle bridges / reloading a bloated
 * renderer stays in mem-guard.ts.
 *
 * ponytail: one global FIFO, no priority and no per-key fairness — cron can
 * queue behind three interactive turns. Add priority classes / per-source
 * fairness if cron starts starving (or starving users).
 */

const MAX_TURNS = (() => {
  const raw = Number(process.env.DESKAPP_MAX_TURNS)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4
})()

export interface TurnSlot {
  /** give the slot back — call exactly once, in a finally */
  release: () => void
}

export interface PendingTurn {
  /** resolves with the running slot, or null when cancelled while queued */
  wait: Promise<TurnSlot | null>
  /** cancel while queued; a running turn is aborted via its own AbortHandle */
  cancel: () => void
}

interface Waiter {
  label: string
  resolve: (s: TurnSlot | null) => void
  cancelled: boolean
  /** set once drain() handed this waiter a slot */
  handed?: () => void
}

const waiting: Waiter[] = []
let running = 0

/**
 * Slot for a background job (cron / gen-ui / habit summary). Callers await
 * `release()` at their terminal callback — they already resolve their own
 * promise there, so wrapping that promise is the whole integration.
 */
export async function holdTurnSlot(label: string): Promise<() => void> {
  const pending = acquireTurnSlot(label)
  const slot = await pending.wait
  return slot ? slot.release : () => { /* cancelled: nothing was started */ }
}

export function queueStats(): { running: number; waiting: number; max: number } {
  return { running, waiting: waiting.length, max: MAX_TURNS }
}

function makeSlot(label: string, onRelease: () => void): TurnSlot {
  let done = false
  const watchdog = setTimeout(() => {
    if (done) return
    console.warn(`[DeskApp] turn slot held >${Math.round(SLOT_MAX_MS / 1000)}s by ${label} — force-releasing (backend never signalled a terminal state)`)
    release()
  }, SLOT_MAX_MS)
  // never keep the process alive for a watchdog
  if (typeof watchdog.unref === 'function') watchdog.unref()

  const release = () => {
    if (done) return
    done = true
    clearTimeout(watchdog)
    onRelease()
  }
  return { release }
}

function free(): void {
  running = Math.max(0, running - 1)
  drain()
}

function drain(): void {
  while (running < MAX_TURNS && waiting.length > 0) {
    const w = waiting.shift()!
    if (w.cancelled) continue
    running++
    w.handed = () => free()
    w.resolve(makeSlot(w.label, w.handed))
  }
}

const SLOT_MAX_MS = (() => {
  const raw = Number(process.env.DESKAPP_TURN_SLOT_MAX_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60_000
})()

/**
 * Wait for a free turn slot. Returns immediately with a pending handle so the
 * caller can wire an abort before the turn actually starts (the renderer's
 * cancel must work while queued, not only while running). `onQueued(position)`
 * fires once when this turn has to wait — the bubble already renders a notice
 * for it.
 *
 * Watchdog: a slot held longer than SLOT_MAX_MS is force-freed with a warning.
 * A wedged backend (bridge alive, never sends done) must not permanently shrink
 * the pool — same reasoning as killBridge()'s SIGKILL fallback.
 */
export function acquireTurnSlot(label: string, onQueued?: (position: number) => void): PendingTurn {
  const w: Waiter = { label, resolve: () => {}, cancelled: false }
  const wait = new Promise<TurnSlot | null>((resolve) => { w.resolve = resolve })

  if (running < MAX_TURNS) {
    running++
    w.handed = () => free()
    w.resolve(makeSlot(w.label, w.handed))
  } else {
    waiting.push(w)
    try { onQueued?.(waiting.length) } catch { /* window gone */ }
    console.log(`[DeskApp] turn queued: ${label} (running=${running}, waiting=${waiting.length}, max=${MAX_TURNS})`)
  }

  return {
    wait,
    cancel: () => {
      if (w.cancelled || w.handed) return // already running — abort via AbortHandle
      w.cancelled = true
      const i = waiting.indexOf(w)
      if (i >= 0) waiting.splice(i, 1) // never started: drop out of the queue
      w.resolve(null)
    },
  }
}
