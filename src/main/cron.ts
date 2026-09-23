// ── P1-B4 #20: cron scheduler — SQLite jobs + 60s tick + boot catch-up ──
// Jobs execute through the shared 'automation' bridge; standing grants are
// applied before execute and removed after. 3 consecutive errors auto-pause.

import { join } from 'path'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const cl = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { CronExpressionParser } from 'cron-parser'
import { bridgeManager } from './agents/desktop-agent'
import { holdTurnSlot } from './turn-queue'
import { addItem } from './inbox'
import * as grants from './agents/grants'

export interface CronJob {
  id: string
  name: string
  schedule: string          // 5-field cron expression
  task: string
  standing_grants: string   // JSON array of "tool" | "tool:command"
  enabled: number
  catch_up: number
  next_run: number
  last_run: number
  status: 'ok' | 'error' | 'auto-paused'
  consecutive_errors: number
}

let DB: any = null
let timer: NodeJS.Timeout | null = null
const resultCallbacks = new Map<string, (ok: boolean, output: string) => void>()
/** Jobs currently executing — tick must not re-fire them. next_run is only
 *  recomputed at run completion, so a 60s tick vs a multi-minute run would
 *  otherwise burst-fire the same job (observed: 盯盘 173s run → 4 fires). */
const runningJobs = new Set<string>()
/** Abort handle per running job — lets window close / stop kill the in-flight
 *  bridge execution so no shadow process survives the spec. */
const jobAborts = new Map<string, { abort: () => void }>()

/** Remove the genui result callback for a job — called when handleRun creates a
 *  new job for the same spec to prevent the old callback from double-firing. */
export function clearResultCallback(id: string): void {
  resultCallbacks.delete(id)
}

/** Re-attach a result callback after a restart (resultCallbacks are in-memory). */
export function attachResultCallback(id: string, cb: (ok: boolean, output: string) => void): void {
  resultCallbacks.set(id, cb)
}

export function initCronStore(appDataPath: string): void {
  try {
    const Database = require('better-sqlite3')
    DB = new Database(join(appDataPath, 'cron.db'))
    DB.exec(`CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule TEXT NOT NULL, task TEXT NOT NULL,
      standing_grants TEXT DEFAULT '[]', enabled INTEGER DEFAULT 1, catch_up INTEGER DEFAULT 0,
      next_run INTEGER DEFAULT 0, last_run INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok', consecutive_errors INTEGER DEFAULT 0)`)
    // Boot catch-up: missed runs while the app was closed
    const now = Date.now()
    for (const j of listJobs()) {
      if (j.enabled && j.catch_up && j.next_run > 0 && j.next_run < now) runJob(j)
      else if (j.enabled && j.next_run === 0) setNextRun(j.id, j.schedule, now)
    }
    if (!timer) timer = setInterval(tick, 60_000)
  } catch (e) { console.warn('[cron] store init failed:', e) }
}

function nextTime(schedule: string, from = Date.now()): number {
  try { return CronExpressionParser.parse(schedule, { currentDate: new Date(from) }).next().getTime() }
  catch { return 0 }
}

function setNextRun(id: string, schedule: string, from: number): void {
  DB?.prepare('UPDATE cron_jobs SET next_run = ? WHERE id = ?').run(nextTime(schedule, from), id)
}

export function listJobs(): CronJob[] {
  if (!DB) return []
  try { return DB.prepare('SELECT * FROM cron_jobs ORDER BY name').all() as CronJob[] } catch { return [] }
}

export function createJob(input: { name: string; schedule: string; task: string; standing_grants?: string[]; catch_up?: boolean; runNow?: boolean; onResult?: (ok: boolean, output: string) => void }): CronJob | { error: string } {
  const next = input.runNow ? Date.now() + 500 : nextTime(input.schedule)
  if (!next) return { error: `无效的 cron 表达式: ${input.schedule}` }
  const id = 'cron-' + Date.now().toString(36)
  DB?.prepare(`INSERT INTO cron_jobs (id, name, schedule, task, standing_grants, catch_up, next_run)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name, input.schedule, input.task,
      JSON.stringify(input.standing_grants || []), input.catch_up ? 1 : 0, next)
  // # ponytail: store result callback per job, O(n) lookup in Map, fine for <100 jobs
  if (input.onResult) resultCallbacks.set(id, input.onResult)
  return listJobs().find(j => j.id === id)!
}

export function updateJob(id: string, patch: Partial<Pick<CronJob, 'name' | 'schedule' | 'task' | 'enabled' | 'catch_up' | 'standing_grants'>>): void {
  const j = listJobs().find(x => x.id === id)
  if (!j || !DB) return
  const merged = { ...j, ...patch }
  DB.prepare(`UPDATE cron_jobs SET name=?, schedule=?, task=?, standing_grants=?, enabled=?, catch_up=?,
    next_run=?, consecutive_errors=CASE WHEN enabled=0 AND ?=1 THEN 0 ELSE consecutive_errors END,
    status=CASE WHEN enabled=0 AND ?=1 THEN 'ok' ELSE status END WHERE id=?`)
    .run(merged.name, merged.schedule, merged.task,
      typeof merged.standing_grants === 'string' ? merged.standing_grants : JSON.stringify(merged.standing_grants),
      merged.enabled, merged.catch_up, nextTime(merged.schedule), merged.enabled, merged.enabled, id)
}

export function deleteJob(id: string): void { DB?.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id) }

/** #21: one-shot wake scheduled by the agent's deskapp_wake tool.
 *  schedule='' marks it one-shot: deleted after it fires. */
export function addOneShot(wakeAt: number, task: string, reason: string): void {
  if (!DB || !wakeAt || !task) return
  const id = 'wake-' + Date.now().toString(36)
  DB.prepare(`INSERT INTO cron_jobs (id, name, schedule, task, catch_up, next_run)
    VALUES (?, ?, '', ?, 1, ?)`)
    .run(id, translate(cl(), 'notify.selfwake', { why: reason.slice(0, 40) || task.slice(0, 40) }), task, wakeAt)
}

function tick(): void {
  const now = Date.now()
  for (const j of listJobs()) {
    if (runningJobs.has(j.id)) continue
    if (j.enabled && j.next_run > 0 && j.next_run <= now) runJob(j)
  }
}

export async function runJob(job: CronJob): Promise<void> {
  if (runningJobs.has(job.id)) return
  runningJobs.add(job.id)
  const applied: grants.Grant[] = []
  try {
    for (const g of JSON.parse(job.standing_grants || '[]') as string[]) {
      const [tool, ...rest] = g.split(':')
      applied.push(grants.addGrant(rest.length ? 'always_command' : 'always_tool', tool, rest.join(':') || undefined))
    }
  } catch { /* malformed grants — run without them */ }
  let output = ''
  let ok = false
  let interrupted = false
  // Retry until success: a failed run (agent error, tool hiccup) must not
  // silently vanish — retry with a delay, unless the user stopped the job.
  // ponytail: 3 attempts × 5min spacing, fixed constants; make them spec
  // fields if a task ever needs a different cadence.
  const RETRY_ATTEMPTS = 3
  const RETRY_DELAY_MS = 5 * 60 * 1000
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      if (!jobAborts.has(job.id)) { interrupted = true; break }  // stopped during the delay
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
    output = ''
    const releaseSlot = await holdTurnSlot(`cron:${job.name}`)
    ok = await new Promise<boolean>((resolve) => {
      bridgeManager.execute('automation', job.task, {
        onChunk: (t) => { output += t },
        onDone: () => resolve(true),
        onError: () => resolve(false),
        onInterrupted: () => { interrupted = true; resolve(false) },  // abort → stop retrying
        autoApprove: true,  // cron automation: no bubble watcher — trust the scheduled task's tools
      }, undefined, true).then((h) => { jobAborts.set(job.id, h) }).catch(() => resolve(false))
    })
    releaseSlot()
    if (ok || interrupted) break
    console.log(`[cron] ${job.name} attempt ${attempt}/${RETRY_ATTEMPTS} failed — retrying in ${RETRY_DELAY_MS / 1000}s`)
  }
  jobAborts.delete(job.id)
  for (const g of applied) grants.removeGrant(g.kind, g.tool, g.command, g.path)
  // Fire genui result callback. ponytail: the callback is NOT deleted here —
  // recurring cron jobs re-fire the same job and need the callback for every
  // run (deleting after the first run silently dropped every later result).
  // One-shot wakes (schedule='') clean up after themselves.
  const cb = resultCallbacks.get(job.id)
  if (cb) { try { cb(ok, ok ? output : '') } catch { /* callback is advisory */ }; if (!job.schedule) resultCallbacks.delete(job.id) }
  // Job deleted (window closed) or disabled (stopped) mid-run → no bookkeeping
  const alive = !!DB && listJobs().some(j => j.id === job.id && j.enabled)
  runningJobs.delete(job.id)
  if (!alive) return
  const now = Date.now()
  if (ok) {
    DB.prepare(`UPDATE cron_jobs SET last_run=?, status='ok', consecutive_errors=0 WHERE id=?`).run(now, job.id)
    addItem({ kind: 'habit-reminder', title: translate(cl(), 'notify.jobDone', { name: job.name }), preview: job.task.slice(0, 80), toolCallId: `cron-${job.id}-${now}` })
  } else {
    const errs = job.consecutive_errors + 1
    DB.prepare(`UPDATE cron_jobs SET last_run=?, status=?, consecutive_errors=? WHERE id=?`)
      .run(now, errs >= 3 ? 'auto-paused' : 'error', errs, job.id)
    if (errs >= 3) DB.prepare('UPDATE cron_jobs SET enabled=0 WHERE id=?').run(job.id)
    addItem({ kind: 'habit-reminder', title: translate(cl(), 'notify.jobFail', { name: job.name }), preview: errs >= 3 ? translate(cl(), 'notify.fail3') : translate(cl(), 'notify.failN', { n: errs }), toolCallId: `cron-${job.id}-${now}` })
  }
  // One-shot wakes (schedule='') fire once and are gone; cron jobs recompute
  if (!job.schedule) { deleteJob(job.id); return }
  setNextRun(job.id, job.schedule, now)
}

/** Abort a job's in-flight bridge execution (used on window close / stop). */
export function cancelJob(id: string): void {
  const h = jobAborts.get(id)
  if (h) { try { h.abort() } catch { /* bridge may be dying */ } }
  jobAborts.delete(id)
}
