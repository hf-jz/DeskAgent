// ── Generative UI core: spec types, validation, store, cron glue, webhook ──
import { join } from 'path'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const gu = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { BrowserWindow } from 'electron'
import { createJob, updateJob, deleteJob, cancelJob, listJobs, runJob, clearResultCallback, attachResultCallback } from './cron'
import { bridgeManager } from './agents/desktop-agent'
import { holdTurnSlot } from './turn-queue'
import { safeSend } from '../shared/ipc-main'
import { COMPONENT_KINDS as KIND_LIST, validateSpec, specUnknownFields, webhookBody, applyPatch, normalizeMd } from '../shared/gen-ui-types'
import { pushDeadLetter } from './deadletter'

// ── Types ──
export const COMPONENT_KINDS = new Set<string>(KIND_LIST)

export interface WindowSpec {
  id: string
  title: string
  kind: string
  cron?: {
    schedule: string
    prompt: string          // template: {{变量}} filled at run time
    standingGrants?: string[]
  }
  props: Record<string, any>
  layout?: { x?: number; y?: number; w?: number; h?: number }
}

export interface SpecStatus {
  specId: string
  status: 'idle' | 'running' | 'ok' | 'error'
  lastRun?: number
  jobId?: string
  error?: string
}

// ── Validation: lives in shared/gen-ui-types.ts (pure, test-importable) ──

// ── Open workspace + dock windows (entry: ipc 'genui:open' + pet context menu) ──
export function openGenUiWindows(): void {
  try {
    const { createWorkspaceWindow, showWorkspace } = require('./workspace-window')
    const { createDockWindow } = require('./dock-window')
    const preloadPath = join(__dirname, '../preload/index.js')
    const wsw = createWorkspaceWindow(preloadPath)
    const dock = createDockWindow(preloadPath)
    // PROBE: which window actually receives the click. before-input-event is
    // keyboard-only, so use a synthetic click as the POSITIVE CONTROL: if the
    // renderer capture probe logs after this, the DOM event path works and
    // real clicks are being swallowed by the OS (activation).
    for (const [name, w] of [['ws', wsw], ['dock', dock]] as const) {
      w.on('focus', () => console.log(`[focus] ${name}`))
    }
    // show() (activated), NOT showInactive(): a panel shown inactive swallows
    // its first click (observed: dock play button dead until any other window
    // interaction activates the app window group). Focus lands on the
    // workspace right after, the dock keeps delivering clicks from click #1.
    dock.show()
    showWorkspace(wsw)
    // No app.focus({steal})/dock.focus() here: programmatic activation +
    // makeKey warps the macOS cursor to the dock window (observed: cursor
    // teleports to the right-edge dock while the pointer was elsewhere).
    // The dock is a plain alwaysOnTop window now — first clicks deliver fine
    // without stealing activation.
  } catch (e) { console.error('[genui] failed to open windows:', e) }
}

// ── Card flow (entry: ipc 'genui:open-card' + bubble 创建功能窗口 chip):
//    dock (wheel switch) + standalone draggable card window. The card binds to
//    the newest spec; defining happens in the bubble chat, running on the card,
//    archiving by dragging the card over the dock. ──
export function openCardFlow(specId?: string): void {
  try {
    const { createDockWindow } = require('./dock-window')
    const { createCardWindow } = require('./card-window')
    const preloadPath = join(__dirname, '../preload/index.js')
    const dock = createDockWindow(preloadPath)
    dock.showInactive()
    createCardWindow(preloadPath, specId)
  } catch (e) { console.error('[genui] failed to open card flow:', e) }
}

// ── Persistent Store (JSON files in userData/specs/) ──
let specsDir = ''

export function initGenUi(appDataPath: string): void {
  specsDir = join(appDataPath, 'specs')
  if (!existsSync(specsDir)) mkdirSync(specsDir, { recursive: true })
  // Shadow-job cleanup: every recurring cron job must back a visible window
  // spec (查看任务/Dock show specs only). A job without one is invisible —
  // delete it. One-shot wakes (schedule='') are transient and exempt.
  try {
    const titles = new Set(listSpecs().map(s => s.title))
    for (const j of listJobs()) {
      if (j.schedule && !titles.has(j.name)) {
        deleteJob(j.id)
        console.log('[genui] deleted shadow cron job:', j.name)
      }
    }
  } catch { /* cron store unavailable */ }

  // Status sync: a spec with an enabled cron job is 运行中 (armed), otherwise
  // 休眠. Statuses are in-memory, so a restart must rebuild them from the
  // scheduler — otherwise the card would show 休眠 for a started task.
  try {
    const jobs = listJobs()
    for (const s of listSpecs()) {
      const job = jobs.find(j => j.name === s.title && j.enabled)
      setStatus(s.id, { status: job ? 'running' : 'idle', jobId: job?.id })
      console.log(`[genui] reconcile ${s.id} "${s.title}" cron=${!!s.cron} → ${job ? 'running' : 'idle'}`)
      // Re-attach the run-result callback: armed jobs survive restarts but the
      // in-memory callback does not — without this, runs after a reboot
      // complete but their results (history entry + webhook) are dropped.
      if (job) attachResultCallback(job.id, makeResultCallback(s))
    }
  } catch { /* scheduler unavailable */ }
}

export function listSpecs(): WindowSpec[] {
  if (!specsDir) return []
  try {
    return readdirSync(specsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(readFileSync(join(specsDir, f), 'utf-8')) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

export function saveSpec(spec: WindowSpec): void {
  writeFileSync(join(specsDir, `${spec.id}.json`), JSON.stringify(spec, null, 2))
}

export function removeSpec(id: string): void {
  // Deleting a window must fully stop its task: drop the result callback,
  // abort any in-flight bridge run (no shadow process), delete the job.
  const st = statuses.get(id)
  if (st?.jobId) {
    try {
      clearResultCallback(st.jobId)
      cancelJob(st.jobId)
      deleteJob(st.jobId)
    } catch { /* job already gone */ }
  }
  statuses.delete(id)
  const p = join(specsDir, `${id}.json`)
  if (existsSync(p)) unlinkSync(p)
  // Freed card returns to draft and can claim the next new window
  require('./card-window').unbindSpec(id)
  broadcastAll('genui:spec-removed', id)
}

// ── Status tracking (in-memory, survives dock lights) ──
const statuses = new Map<string, SpecStatus>()

export function getStatus(specId: string): SpecStatus {
  return statuses.get(specId) || { specId, status: 'idle' }
}

export function listStatuses(): SpecStatus[] {
  return [...statuses.values()]
}

export function setStatus(specId: string, patch: Partial<SpecStatus>): void {
  statuses.set(specId, { ...getStatus(specId), ...patch, specId })
}

// ── Webhook URL (ponytail: flat file alongside specs/, no settings UI for G1) ──
function webhookUrl(): string {
  try {
    const p = join(specsDir, '..', 'webhook-url.txt')
    if (existsSync(p)) return readFileSync(p, 'utf-8').trim()
  } catch { /* absent */ }
  return ''
}

function setWebhookUrl(url: string): void {
  try {
    writeFileSync(join(specsDir, '..', 'webhook-url.txt'), url.trim())
  } catch { /* perm error */ }
}

// ── Broadcast helper ──
function broadcastAll(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) {
    safeSend(w.webContents, channel, ...args)
  }
}

// Shared run-result callback: appends the markdown history entry, broadcasts,
// and pings the webhook. Attached at job creation AND re-attached at boot
// (reconcile) — resultCallbacks are in-memory and die with the process, while
// the armed cron job survives a restart (root cause: runs after a restart
// completed but their results were dropped → no entry, no webhook).
function makeResultCallback(spec: WindowSpec): (ok: boolean, output: string) => void {
  return (ok: boolean, output: string) => {
    const specId = spec.id
    // The task stays 运行中 after each run — its cron job is still armed.
    // 休眠 only after an explicit stop.
    const st: SpecStatus = { specId, status: 'running', lastRun: Date.now() }
    if (!ok) {
      st.error = 'cron execution failed'
      pushDeadLetter('cron', translate(gu(), 'notify.jobFail', { name: spec.title }), `specId=${specId}`)
    }
    // Each run appends ONE announcement-style history entry (markdown body).
    if (ok && output) {
      try {
        const history: { title: string; content: string; ts: number }[] = Array.isArray(spec.props?.history) ? spec.props.history : []
        const when = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const title = `${pad(when.getFullYear())}.${pad(when.getMonth() + 1)}.${pad(when.getDate())} · ${spec.title}`
        spec.props = { ...spec.props, history: [...history.slice(-49), { title, content: normalizeMd(output), ts: when.getTime() }] }
        saveSpec(spec)
      } catch { /* keep existing props */ }
    }
    setStatus(specId, st)
    console.log(`[genui] onResult ${specId} ok=${ok} outputLen=${output?.length || 0}${st.error ? ` err=${st.error}` : ''}`)
    broadcastAll('genui:spec-changed', spec)
    broadcastAll('genui:status-changed', st)
    notifyWebhook(specWebhook(spec), { event: ok ? 'cron:complete' : 'cron:error', specId, ok, title: spec.title, output: normalizeMd(output) })
  }
}

// ── Run: template fill → cron.createJob → immediate execution → webhook ──
export function handleRun(spec: WindowSpec): { jobId: string } | { error: string } {
  console.log('[genui] handleRun:', spec.id, spec.title, 'cron=', spec.cron?.schedule)
  if (!spec.cron) return { error: 'no cron config' }
  const task = spec.cron.prompt.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = spec.props[key]
    return v != null ? String(v) : `{{${key}}}`
  })
  const specId = spec.id

  // Stop any existing cron jobs for this spec (prevents duplicate runs)
  for (const j of listJobs()) {
    if (j.name === spec.title && j.enabled) {
      updateJob(j.id, { enabled: 0 })
      clearResultCallback(j.id)  // prevent old callback from firing on completion
    }
  }

  const result = createJob({
    name: spec.title,
    schedule: spec.cron.schedule,
    task,
    standing_grants: spec.cron.standingGrants || [],
    runNow: true,
    onResult: makeResultCallback(spec),
  })
  if ('error' in result) return result

  const job = result
  // Guard against tick double-fire: push next_run far out, runJob will recalc
  updateJob(job.id, { schedule: job.schedule }) // re-sets next_run via setNextRun
  setStatus(spec.id, { status: 'running', jobId: job.id })
  broadcastAll('genui:status-changed', getStatus(spec.id))
  notifyWebhook(specWebhook(spec), { event: 'spec:running', specId: spec.id, jobId: result.id })

  // Fire immediately instead of waiting up to 60s for the tick
  const freshJob = listJobs().find(j => j.id === job.id)
  if (freshJob) runJob(freshJob)

  return { jobId: result.id }
}

// ── Stop: disable the cron job backing this spec ──
export function handleStop(specId: string): { ok: boolean; error?: string } {
  console.log('[genui] handleStop:', specId)
  const jobId = getStatus(specId).jobId
  if (!jobId) return { ok: false, error: 'not running' }
  const job = listJobs().find(j => j.id === jobId)
  if (!job) {
    // Job row already gone (one-shot wake / store cleanup) — the status is
    // stale; clear it or the run/stop button stays stuck on "running".
    setStatus(specId, { status: 'idle' })
    broadcastAll('genui:status-changed', getStatus(specId))
    return { ok: true }
  }
  updateJob(jobId, { enabled: 0 })
  // Stop mid-run: drop the callback and abort the in-flight bridge execution
  // so it can't re-arm the status or keep running in the background.
  clearResultCallback(jobId)
  cancelJob(jobId)
  setStatus(specId, { status: 'idle' })
  broadcastAll('genui:status-changed', getStatus(specId))
  return { ok: true }
}

// ── Save (manual field edit from the window UI): validate → persist → broadcast ──
export function handleSave(raw: unknown): { ok: boolean; error?: string } {
  // strict: this is deliberate user input — a misspelled field must fail loudly
  const validated = validateSpec(raw, { strict: true })
  if ('error' in validated) return { ok: false, error: validated.error }
  saveSpec(validated)
  broadcastAll('genui:spec-changed', validated)
  return { ok: true }
}

// ── LLM spec generation / modification ──
export async function generateSpec(instruction: string, currentSpec?: WindowSpec): Promise<WindowSpec | { error: string }> {
  const prompt = currentSpec
    ? `Modify this window spec according to: "${instruction}"\n\nCurrent spec:\n${JSON.stringify(currentSpec, null, 2)}\n\nReturn ONLY the full updated JSON (same id).`
    : `Create a DeskApp window spec for: "${instruction}"\n\nReturn ONLY the JSON. Available kinds: ${[...COMPONENT_KINDS].join(', ')}.\n\nRequired format:\n{"id":"unique-id","title":"Window Title","kind":"one of the kinds","cron":{"schedule":"cron expr","prompt":"task prompt with {{vars}}"},"props":{...}}`

  const releaseSlot = await holdTurnSlot('gen-ui:spec')
  const result = new Promise<WindowSpec | { error: string }>((resolve) => {
    let full = ''
    bridgeManager.execute('gen-ui', prompt, {
      onChunk: (t) => { full += t },
      onDone: () => {
        try {
          const match = full.match(/```(?:json)?\s*([\s\S]*?)```/)
          const json = match ? match[1].trim() : full.trim()
          const parsed = JSON.parse(json)
          // LLM output: lenient (drop unknown keys) but report them — a model
          // inventing fields is a prompt problem we want visible, not silent.
          const unknown = specUnknownFields(parsed)
          if (unknown.length) pushDeadLetter('cron', `LLM spec had unknown field(s): ${unknown.join(', ')}`, json.slice(0, 400))
          const validated = validateSpec(parsed)
          if ('error' in validated) { resolve(validated); return }
          saveSpec(validated)
          // A draft card waiting for a definition claims this brand-new spec
          if (!currentSpec) require('./card-window').bindNewestSpec(validated.id)
          resolve(validated)
        } catch (e) { resolve({ error: `Failed to parse agent output: ${(e as Error).message}` }) }
      },
      onError: (err: string) => resolve({ error: err }),
    }, undefined, true).catch((e: Error) => resolve({ error: e.message }))
  })
  return result.finally(releaseSlot)
}

// ── Agent tool entry: genui_request bridge event ──
export function handleAgentRequest(ev: { action?: string; spec_id?: string; spec?: unknown; ops?: unknown }): void {
  const action = ev.action
  if (action === 'create' || action === 'update') {
    // agent tool call: strict — a field the agent invents is a bug in its prompt
    const validated = validateSpec(ev.spec, { strict: true })
    if ('error' in validated) {
      pushDeadLetter('cron', `agent spec invalid: ${validated.error}`, JSON.stringify(ev.spec).slice(0, 400))
      return
    }
    saveSpec(validated)
    broadcastAll('genui:spec-changed', validated)
    openCardFlow(validated.id)   // 卡片窗口立即具象化（可定义/运行/拖入 Dock 归档）
    return
  }
  const id = String(ev.spec_id || '')
  if (!id) return
  if (action === 'patch') {
    // 增量更新: RFC 6902 ops → 应用 → 校验 → 广播, 窗口无闪烁局部刷新
    const spec = listSpecs().find(s => s.id === id)
    if (!spec) return
    const patched = applyPatch(spec, ev.ops)
    if (typeof patched === 'object' && patched !== null && 'error' in patched) {
      pushDeadLetter('cron', `agent patch invalid: ${(patched as any).error}`, JSON.stringify(ev.ops).slice(0, 400))
      return
    }
    const validated = validateSpec(patched, { strict: true })
    if ('error' in validated) {
      pushDeadLetter('cron', `agent patch broke spec: ${validated.error}`, id)
      return
    }
    saveSpec(validated)
    broadcastAll('genui:spec-changed', validated)
    return
  }
  if (action === 'run') {
    const spec = listSpecs().find(s => s.id === id)
    if (!spec) return
    const r = handleRun(spec)
    if (!('error' in r)) setStatus(id, { status: 'running', jobId: r.jobId })
    broadcastAll('genui:status-changed', getStatus(id))
  } else if (action === 'stop') {
    handleStop(id)
  } else if (action === 'remove') {
    removeSpec(id)  // clears status + broadcasts spec-removed itself
  }
}

// ── Webhook utils (fire-and-forget) ──
/** Per-spec webhook (props.webhook) overrides the global one. */
function specWebhook(spec: WindowSpec): string {
  const own = spec.props?.webhook
  return typeof own === 'string' && own.startsWith('https://') ? own : webhookUrl()
}

/** Format payload per platform: WeCom bot wants msgtype/text, Feishu wants msg_type/content.
 *  Implementation lives in shared/gen-ui-types.ts (pure, test-importable). */

export async function notifyWebhook(url: string, payload: Record<string, any>): Promise<void> {
  if (!url?.startsWith('https://')) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: webhookBody(url, payload),
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* network loss — silently drop */ }
}

export { webhookUrl as getWebhookUrl, setWebhookUrl }
