// ── Memory guard ──
//
// DeskApp's freeze mode is memory, not CPU: Electron main+GPU+2 renderers is
// ~150MB (stable), but every live python bridge is ~135MB (measured with
// `footprint`) and a runaway renderer can grow without bound. This samples both
// once a minute, logs one line so the next incident is diagnosable from the log,
// and reacts before the machine starts swapping:
//
//   - over SOFT: reclaim the unpinned (cron / gen-ui) bridges, then the warm spare
//   - any single renderer over RENDERER_MB: reload it — a >1GB webview is already
//     broken, and a reload beats a frozen window (crash-recovery would not fire,
//     the process is alive)
//
// Window-owned bridges are never reaped (standing requirement: an open bubble
// stays warm) — the guard only takes back what is provably idle. Thresholds are
// env-overridable so they can be tuned against real usage.

import { app, webContents } from 'electron'
import { execFileSync } from 'child_process'
import { bridgeManager, BRIDGE_MB_ESTIMATE } from './agents/desktop-agent'
import { queueStats } from './turn-queue'

const TICK_MS = 60_000
const RELOAD_COOLDOWN_MS = 10 * 60_000
/** Background (cron / gen-ui) bridges are reaped this long after their last task —
 *  they are unpinned by construction, so a bubble's bridge is never touched. */
const BG_IDLE_REAP_MS = 30 * 60_000

const num = (v: string | undefined, d: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}
const SOFT_MB = num(process.env.DESKAPP_MEM_SOFT_MB, 1200)
const RENDERER_MB = num(process.env.DESKAPP_MEM_RENDERER_MB, 1000)

let timer: ReturnType<typeof setInterval> | null = null
const lastReload = new Map<number, number>()
/** Last sampled figures — surfaced by the doctor check instead of re-sampling. */
let last: MemSample | null = null

export function lastSample(): MemSample | null { return last }

export interface MemSample {
  /** every Electron process (browser + GPU + utility + renderers), MB */
  electronMB: number
  byType: Record<string, number>
  renderers: { pid: number; mb: number }[]
  /** live bridge count and their estimated resident cost */
  bridges: number
  bridgeMB: number
  totalMB: number
}

/**
 * Real RSS of one bridge process, in MB — python has no shared-framework
 * inflation, so RSS ≈ its footprint. Returns null when the pid is gone or `ps`
 * is unavailable, and the caller falls back to BRIDGE_MB_ESTIMATE.
 *
 * ponytail: one `ps` spawn per bridge per tick (≤ a handful, 60s cadence) —
 * switch to a single `ps -p p1,p2,…` call if the bridge count ever climbs.
 */
export function measureRssMB(pid: number): number | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'rss='], { encoding: 'utf-8', timeout: 2000 })
    const kb = Number(out.trim())
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null
  } catch { return null }
}

export function sampleMemory(): MemSample {
  const byType: Record<string, number> = {}
  const renderers: { pid: number; mb: number }[] = []
  let electronMB = 0
  for (const m of app.getAppMetrics()) {
    // workingSetSize counts the shared Electron framework pages in every
    // process (~3.5x the real footprint), so treat these figures as a relative
    // proxy: thresholds below are calibrated against measured idle values
    // (~660MB "total" at idle) rather than absolute RAM.
    const info = m.memory
    const mb = (info.workingSetSize || 0) / 1024
    electronMB += mb
    byType[m.type] = (byType[m.type] ?? 0) + mb
    if (m.type === 'Tab') renderers.push({ pid: m.pid, mb })
  }

  // Measure the bridges that are alive, fall back to the constant for any pid
  // the probe missed — a pressure decision built purely on estimates reaps the
  // wrong thing (see skill references/memory-management.md).
  let bridgeMB = 0
  let measured = 0
  for (const s of bridgeManager.processStats()) {
    if (s.pid == null) continue
    const rss = measureRssMB(s.pid)
    if (rss != null) { bridgeMB += rss; measured++ }
  }
  const total = bridgeManager.totalCount
  bridgeMB += Math.max(0, total - measured) * BRIDGE_MB_ESTIMATE

  return {
    electronMB,
    byType,
    renderers,
    bridges: bridgeManager.activeCount,
    bridgeMB,
    totalMB: electronMB + bridgeMB,
  }
}

const mb = (n: number): number => Math.round(n)

/** One guard tick. */
export function tick(): void {
  const s = sampleMemory()
  last = s
  const breakdown = Object.entries(s.byType).map(([k, v]) => `${k} ${mb(v)}`).join(', ')
  const q = queueStats()
  console.log(`[DeskApp] mem total=${mb(s.totalMB)}MB electron=${mb(s.electronMB)}MB (${breakdown}) bridges=${s.bridges} (~${mb(s.bridgeMB)}MB, ${s.bridgeMB ? 'measured' : 'none'}) turns=${q.running}/${q.max}${q.waiting ? `(+${q.waiting} queued)` : ''}`)

  // Routine: hand back background bridges that finished their job long ago
  // (~135MB each). Pinned (bubble-owned) entries are never selected by policy.
  const idle = bridgeManager.reapIdle({ maxIdleMs: BG_IDLE_REAP_MS })
  if (idle.length) console.log(`[DeskApp] mem: reaped idle background bridges [${idle.join(', ')}]`)

  if (s.totalMB <= SOFT_MB) return
  const reaped = bridgeManager.reapIdle({ maxIdleMs: 0 })
  const droppedSpare = bridgeManager.dropSpare('memory pressure')
  console.log(`[DeskApp] mem pressure: total=${mb(s.totalMB)}MB > ${SOFT_MB}MB — reaped [${reaped.join(', ')}]${droppedSpare ? ' + spare' : ''}`)

  for (const r of s.renderers) {
    if (r.mb <= RENDERER_MB) continue
    const now = Date.now()
    if (now - (lastReload.get(r.pid) ?? 0) < RELOAD_COOLDOWN_MS) continue
    const wc = webContents.getAllWebContents().find((w) => w.getOSProcessId() === r.pid)
    lastReload.set(r.pid, now)
    if (!wc || wc.isDestroyed()) continue
    console.log(`[DeskApp] mem pressure: renderer pid=${r.pid} ${mb(r.mb)}MB > ${RENDERER_MB}MB — reloading`)
    try { wc.reload() } catch { /* window racing destruction */ }
  }
}

export function startMemGuard(): void {
  stopMemGuard()
  timer = setInterval(tick, num(process.env.DESKAPP_MEM_TICK_MS, TICK_MS))
}

export function stopMemGuard(): void {
  if (timer) { clearInterval(timer); timer = null }
  lastReload.clear()
}
