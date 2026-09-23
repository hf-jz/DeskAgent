import { spawn, ChildProcess, execSync } from 'child_process'
import { translate, type Lang } from '../../shared/locales'
import { loadSettings } from '../settings-store'
const da = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs'
import type { TaskStreamCallbacks, PermissionRequest, QuestionRequest } from './types'
import type { AgentExecutor, AbortHandle, RunnerSpec } from './executor'
import { selectReaps, type BridgeStat } from './bridge-policy'
import { parseFrame, errorCodeOf, PROTOCOL_VERSION } from './bridge-protocol'

// D1 #43: packaged builds keep resources outside the asar (see asarUnpack) —
// resolve against process.resourcesPath there, app path in dev.
// Exported: other main-process features (pptx export, …) must resolve their
// bundled scripts the same way instead of hardcoding an author-machine path.
export function resourcesDir(): string {
  const { app } = require('electron')
  // asarUnpack lands files under <resources>/app.asar.unpacked/resources
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
}

// ── Bridge process bookkeeping ──
// A hard crash of the app (kill -9 / SIGKILL) leaves the python bridges running:
// each holds ~135MB and the venv, and nothing will ever talk to them again.
// We record pids and reap the orphans on the next start.
//
// NOTE: an orphan cannot be ADOPTED (unlike ax's sidecar, which listened on TCP
// and could be re-attached). This bridge speaks JSONL over the stdio pipes of
// its dead parent, so the only safe action is to kill it.

function bridgePidFile(): string {
  const { app } = require('electron')
  return join(app.getPath('userData'), 'bridge-pids')
}

function recordBridgePid(pid: number | undefined): void {
  if (!pid) return
  try { appendFileSync(bridgePidFile(), `${pid}\n`) } catch { /* best effort */ }
}

/** Kill bridge processes left over from a previous hard crash. */
export function reapOrphanBridges(): void {
  let lines: string[]
  try { lines = readFileSync(bridgePidFile(), 'utf-8').split('\n') } catch { return }
  let killed = 0
  for (const raw of lines) {
    const pid = Number(raw.trim())
    if (!Number.isInteger(pid) || pid <= 1) continue
    try { process.kill(pid, 0) } catch { continue } // signal 0 = liveness probe; gone already
    try {
      const cmd = execSync(`ps -p ${pid} -o command=`, { timeout: 2000 }).toString()
      if (!cmd.includes('bridge.py')) continue // pid recycled by an unrelated process
      process.kill(pid, 'SIGKILL')
      killed++
    } catch { /* ps failed / exited between probe and kill */ }
  }
  try { writeFileSync(bridgePidFile(), '') } catch { /* best effort */ }
  if (killed) console.log(`[DeskApp] reaped ${killed} orphan bridge process(es) from a previous run`)
}

// ── Bridge state machine ──
type BridgeState = 'idle' | 'starting' | 'ready' | 'running' | 'error'

/** Max bridge silence before a task is killed and surfaced as an error. */
// ponytail: 24h instead of 300s — the silent-kill contradicted the user
// requirement (an open bubble's task must never be killed for being slow /
// waiting on the provider). What actually detects a hung provider is the
// bridge-side first-output watchdog (resources/bridge.py: FIRST_OUTPUT_WARN_S /
// FIRST_OUTPUT_TIMEOUT_S → health frame, then error[timeout]) plus the `health`
// frames below, which let this side tell "long tool run, still alive" from
// "wedged". This constant now only survives a process that stopped emitting
// frames *and* stopped answering the watchdog.
const HEARTBEAT_MS = 24 * 60 * 60 * 1000

/** No frame of any kind (output or health) for this long during a turn → warn in
 *  the log + inbox. Deliberately a warning: killing a live turn loses work, and
 *  the bridge's own watchdog owns the "provider never answered" verdict. */
const HEALTH_STALL_MS = (() => {
  const raw = Number(process.env.DESKAPP_STALL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
})()

/** Kill the bridge after this many ms of idle (ready + no queued tasks). */
// ponytail: 24h instead of 5min — user requirement: an open bubble's bridge
// must never be killed by idle, no matter how long since the last question.
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Resident cost of one live bridge, measured with `footprint` (agent loaded). */
const BRIDGE_MB = 135
/** Fallback cost of ONE bridge when its pid can't be probed (process just
 *  exited, ps unavailable). Exported so mem-guard charges the same constant
 *  for the bridges it could not measure instead of keeping a second estimate. */
export const BRIDGE_MB_ESTIMATE = BRIDGE_MB

/** Safety cap for non-pinned (background) bridges — see reapIdle(). */
const MAX_LIVE_BRIDGES = 4

/** One queued task (main-side serialization of bridge work). */
interface QueuedTask {
  task: string
  cbs: TaskStreamCallbacks
  modelOverride?: { model: string; provider: string }
  aborted: boolean
}

/**
 * Manages the embedded Python bridge process.
 * Single shared process, serialized task execution.
 * Abort = kill bridge, auto-restart on next task.
 */
class DesktopAgentBridge {
  private proc: ChildProcess | null = null
  private buffer = ''
  private state: BridgeState = 'idle'
  private pythonBin: string | null = null
  /** Active task callbacks (null when idle) */
  private cbs: TaskStreamCallbacks | null = null
  /** Resolver for the current execute() promise (signals task completion) */
  private taskDone: ((success: boolean, msg?: string) => void) | null = null
  /** Whether this task has been aborted */
  private taskAborted = false
  /** Accumulated text for graceful interrupt (P0-2a) */
  private accumulatedText = ''
  /** Heartbeat for bridge timeout detection (P0-2c) */
  private lastHeartbeat = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** Idle timer: kills the bridge after IDLE_TIMEOUT_MS of no activity */
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** one-shot guard: protocol mismatch is logged once, not per frame */
  private protocolWarned = false
  /** one-shot guard: stall warning (no frames at all) is raised once per turn */
  private stallWarned = false
  /** one-shot guard: "still waiting for the provider" logged once per turn */
  private firstTokenWarned = false
  /** Main-side task FIFO — one task at a time per bridge (see execute()) */
  private queue: QueuedTask[] = []
  private draining = false
  private currentItem: QueuedTask | null = null
  /** Phase 6: approval cards awaiting a user decision (id → request) */
  private pendingApprovals = new Map<string, PermissionRequest>()
  // #33: pending ask_user question cards
  private pendingQuestions = new Map<string, QuestionRequest>()

  // ── Public API ──

  /** Start the bridge (must be in idle state) */
  private startPromise: Promise<void> | null = null

  async start(): Promise<void> {
    if (this.state === 'ready') return
    // Concurrent callers (warmup + execute) share ONE spawn — awaiting the
    // in-flight promise so execute() never writes to a not-yet-ready proc.
    if (this.startPromise) return this.startPromise
    if (this.state !== 'idle' && this.state !== 'error') return

    this.state = 'starting'
    this.startPromise = (async () => {
      this.pythonBin = await this.findPython()

      if (!this.pythonBin) {
        // Try bootstrap via uv
        await this.bootstrapPython()
      }

      if (!this.pythonBin) {
        this.state = 'error'
        throw new Error('No Python runtime available')
      }

      await this.spawnBridge()
    })()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  /**
   * Execute a task, streaming results via callbacks. Returns abort handle.
   * modelOverride routes this turn to a different model (worker tier) —
   * the bridge keeps conversation history across model switches.
   *
   * Tasks are SERIALIZED here in main (FIFO queue): bridge.py queues too, but
   * this class owns a single cbs/taskDone slot — two execute() calls in flight
   * used to clobber each other (the second turn stole the first task's
   * completion, so cron onResult never fired and chat answers were dropped).
   * Abort of a queued (not yet started) task just drops it; abort of the
   * running task kills the bridge as before.
   */
  async execute(task: string, cbs: TaskStreamCallbacks, modelOverride?: { model: string; provider: string }): Promise<AbortHandle> {
    console.log('[DeskApp Engine] execute (queued):', task.substring(0, 60), modelOverride ? `[${modelOverride.model}]` : '[default]')
    const item: QueuedTask = { task, cbs, modelOverride, aborted: false }
    this.queue.push(item)
    this.drain().catch((e) => console.error('[DeskApp Engine] drain error:', (e as Error).message))
    return { abort: () => this.abortTask(item) }
  }

  /** True while any task is running or waiting in the queue. */
  isBusy(): boolean {
    return this.draining
  }

  /** OS pid of the bridge process (null when not spawned). */
  pid(): number | null {
    return this.proc?.pid ?? null
  }

  /** Interpreter this bridge runs on (null before start). */
  python(): string | null {
    return this.pythonBin
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!
        if (item.aborted) { item.cbs.onInterrupted?.(''); continue }
        this.clearIdleTimer() // task incoming — cancel any pending idle kill
        await this.runOne(item)
      }
    } finally {
      this.draining = false
    }
  }

  /** Abort: queued → drop from FIFO; running → graceful interrupt (kill bridge). */
  private abortTask(item: QueuedTask): void {
    if (item.aborted) return
    item.aborted = true
    if (this.currentItem !== item) {
      // Not started yet — remove from the queue, nothing to kill
      const i = this.queue.indexOf(item)
      if (i >= 0) this.queue.splice(i, 1)
      item.cbs.onInterrupted?.('')
      return
    }
    // Running task — P0-2a: preserve partial output, kill bridge
    this.taskAborted = true
    console.log('[DeskApp Engine] Graceful abort — preserving partial output')
    const partialText = this.accumulatedText
    this.clearPendingApprovals('abort')  // Phase 6: invalidate open cards
    this.killBridge()
    // Resolve the running task so the drain loop can start the next one
    this.taskDone?.(false, 'aborted')
    this.cleanupTask()
    this.state = 'idle'
    this.currentItem = null
    item.cbs.onInterrupted?.(partialText)
  }

  /** Run one queued task to completion (bridge stays up for the next task). */
  private runOne(item: QueuedTask): Promise<void> {
    const { cbs, task, modelOverride } = item
    return new Promise<void>((resolve) => {
      let finished = false

      // Reset on error state / dead proc before (re)starting the bridge
      if (this.state === 'error') this.state = 'idle'
      if (!this.isAlive() && this.state !== 'idle') this.state = 'idle'
      this.currentItem = item
      this.clearIdleTimer()

      const startBridge = async () => {
        if (this.state !== 'ready') await this.start()

        this.state = 'running'
        this.cbs = cbs
        this.taskAborted = false
        this.accumulatedText = ''
        this.lastHeartbeat = Date.now()
        this.stallWarned = false
        this.firstTokenWarned = false

        // Heartbeat: HEARTBEAT_MS without bridge output → kill + surface error.
        // (The old path killed the bridge but never notified the renderer —
        // the bubble stayed on "thinking…" forever.)
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = setInterval(() => {
          const silentMs = Date.now() - this.lastHeartbeat
          // Phase 6: an open approval card is NOT unresponsiveness — the bridge
          // is legitimately blocked waiting for the user's decision (up to 120s).
          if (this.pendingApprovals.size > 0) return
          // Stalled but not yet dead: a live turn that stopped sending anything
          // (no text, no tool frame, no health) is surfaced instead of leaving
          // the bubble on "thinking…" with no explanation. Locked to once per turn.
          if (silentMs > HEALTH_STALL_MS && this.state === 'running' && !finished
              && !this.taskAborted && !this.stallWarned) {
            this.stallWarned = true
            console.warn(`[DeskApp Engine] turn stalled: ${Math.round(silentMs / 1000)}s without any frame`)
            try {
              const { addItem } = require('../inbox')
              addItem({
                kind: 'agent-offline',
                title: translate(da(), 'notify.engineStalled'),
                preview: `${Math.round(silentMs / 1000)}s`,
                toolCallId: `stall-${Date.now()}`,
              })
            } catch { /* inbox not initialized yet */ }
          }
          if (silentMs > HEARTBEAT_MS && this.state === 'running' && !finished && !this.taskAborted) {
            console.log(`[DeskApp Engine] Bridge timeout: ${Math.round(silentMs / 1000)}s silent`)
            this.taskAborted = true
            this.killBridge()
            this.cleanupTask()
            this.state = 'idle'
            this.currentItem = null
            resolve()
            cbs.onError(translate(da(), 'notify.timeout', { s: Math.round(silentMs / 1000) }))
          }
        }, 10_000)

        // Completion resolver — called by parseLines ('done'/'error') or abort
        this.taskDone = (success: boolean, msg?: string) => {
          finished = true
          this.currentItem = null
          resolve()
          if (this.taskAborted) return
          this.state = 'ready'
          this.cbs = null
          this.taskDone = null
          this.flushContext()
          // Start idle timer — drain() will clear it if more tasks are queued
          this.startIdleTimer()
          if (success) cbs.onDone()
          else cbs.onError(msg || 'Unknown error')
        }

        // Write task to bridge
        const msg: Record<string, string> = { type: 'task', message: task }
        if (cbs.autoApprove) msg.auto_approve = '1'
        if (modelOverride) {
          msg.model = modelOverride.model
          msg.provider = modelOverride.provider
        }
        this.proc?.stdin?.write(JSON.stringify(msg) + '\n')
      }

      startBridge().catch((e) => {
        this.currentItem = null
        resolve()
        cbs.onError('Engine start failed: ' + (e as Error).message)
      })
    })
  }

  /** Pre-warm the bridge in the background (spawn + agent init) without
   *  running a task. Used while a task-tree runs, so the follow-up simple
   *  turn doesn't pay the 5-15s cold start. */
  warmup(): void {
    if (this.state !== 'idle') return
    this.start().then(() => this.startIdleTimer())
      .catch(e => console.log('[DeskApp Engine] warmup failed:', (e as Error).message))
  }

  /** Inject a (user, assistant) pair into the bridge conversation history
   *  WITHOUT running the model. Syncs tasks executed outside the bridge
   *  (task-tree orchestration) so follow-up turns have full context.
   *  Queued when the bridge is busy or not yet spawned; flushed on ready. */
  private pendingContext: { user: string; assistant: string }[] = []

  injectContext(user: string, assistant: string): void {
    this.pendingContext.push({ user: user.slice(0, 4000), assistant: assistant.slice(0, 12000) })
    this.flushContext()
  }

  /** Phase 6: forward the user's decision for a pending approval to the
   *  bridge's stdin. Returns false when the id is unknown (already timed
   *  out / aborted) — the renderer treats that as first-responder-wins loss. */
  respondPermission(id: string, outcome: 'once' | 'session' | 'always' | 'deny'): boolean {
    if (!this.pendingApprovals.has(id)) return false
    this.pendingApprovals.delete(id)
    this.auditLog('permission_decision', outcome, id)
    try {
      this.proc?.stdin?.write(JSON.stringify({ type: 'permission_response', id, outcome }) + '\n')
    } catch { /* bridge may be dying — bridge side times out on its own */ }
    this.lastHeartbeat = Date.now()
    this.cbs?.onPermissionResolved?.(id, 'responded')
    return true
  }

  /** #33: forward the user's answer to the bridge's blocked clarify thread. */
  respondQuestion(id: string, answer: string): boolean {
    if (!this.pendingQuestions.has(id)) return false
    this.pendingQuestions.delete(id)
    try {
      this.proc?.stdin?.write(JSON.stringify({ type: 'question_response', id, answer }) + '\n')
    } catch { /* bridge may be dying */ }
    this.lastHeartbeat = Date.now()
    this.cbs?.onQuestionResolved?.(id, 'responded')
    return true
  }

  /** Phase 6: invalidate all pending cards (abort / crash / kill) */
  private clearPendingApprovals(reason: 'abort' | 'timeout'): void {
    if (this.pendingApprovals.size === 0) return
    const ids = [...this.pendingApprovals.keys()]
    this.pendingApprovals.clear()
    for (const id of ids) this.cbs?.onPermissionResolved?.(id, reason)
  }

  private flushContext(): void {
    if (!this.isAlive() || this.state === 'running' || this.pendingContext.length === 0) return
    for (const c of this.pendingContext) {
      this.proc?.stdin?.write(JSON.stringify({ type: 'context', user: c.user, assistant: c.assistant }) + '\n')
      console.log('[DeskApp Engine] context injected:', c.user.substring(0, 50))
    }
    this.pendingContext = []
  }

  /** Check if bridge process is alive */
  isAlive(): boolean {
    return this.proc !== null && !this.proc.killed && this.proc.exitCode === null
  }

  /** Full shutdown */
  shutdown(): void {
    this.clearIdleTimer()
    this.killBridge()
    this.cleanupTask()
    this.state = 'idle'
    this.pythonBin = null
  }

  /** Start the idle timer — kills bridge after IDLE_TIMEOUT_MS of no activity. */
  private startIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this.state === 'ready' && this.queue.length === 0 && this.currentItem === null) {
        console.log('[DeskApp Engine] idle timeout — killing bridge')
        this.killBridge()
        this.cleanupTask()
        this.state = 'idle'
      }
    }, IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  // ── Internals ──

  private cleanupTask(): void {
    this.cbs = null
    this.taskDone = null
    this.buffer = ''
    this.accumulatedText = ''
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    this.clearIdleTimer()
  }

  private killBridge(): void {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    try { proc.kill('SIGTERM') } catch { /* already gone */ }
    // SIGTERM → 3s → SIGKILL (ax sidecar.go:Stop semantics): a python process
    // blocked in a C call ignores SIGTERM and would linger as a ~135MB zombie.
    const t = setTimeout(() => {
      if (proc.exitCode === null) {
        try { proc.kill('SIGKILL') } catch { /* exited in the meantime */ }
      }
    }, 3000)
    t.unref?.()
  }

  private auditLogDir: string | null = null
  /** Strip sensitive data before writing to the audit log. */
  private sanitizeForAudit(s: string): string {
    // Redact common credential patterns: API keys, tokens, passwords
    return s
      .replace(/(?:api[_-]?key|apiKey|apikey|secret|token|password|passwd|credential)\s*[:=]\s*[\S]+/gi, '$1=***REDACTED***')
      .replace(/(?:Bearer|Basic)\s+\S+/gi, '$1 ***REDACTED***')
      .substring(0, 500)
  }
  private auditLog(event: string, name?: string, detail?: string): void {
    try {
      if (!this.auditLogDir) {
        const { app } = require('electron')
        this.auditLogDir = join(app.getPath('userData'), 'audit')
        const { mkdirSync } = require('fs')
        mkdirSync(this.auditLogDir, { recursive: true })
      }
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        name: name || '',
        detail: this.sanitizeForAudit(detail || ''),
      }) + '\n'
      const { appendFileSync } = require('fs')
      appendFileSync(join(this.auditLogDir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`), line)
    } catch {}
  }

  private async findPython(): Promise<string | null> {
    const candidates: string[] = []
    // Embedded venv (first priority)
    try {
      const { app } = require('electron')
      candidates.push(join(app.getPath('userData'), 'deskapp-agent-venv', 'bin', 'python3'))
    } catch {}
    // System hermes venv
    candidates.push(join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'))
    candidates.push('/opt/homebrew/bin/python3')
    candidates.push('/usr/bin/python3')
    for (const p of candidates) {
      if (existsSync(p)) {
        console.log('[DeskApp Engine] Found Python:', p)
        return p
      }
    }
    return null
  }

  private async spawnBridge(): Promise<void> {
    const { app } = require('electron')
    const bridgeScript = join(resourcesDir(), 'bridge.py')

    if (!existsSync(bridgeScript)) {
      this.state = 'error'
      throw new Error('bridge.py not found')
    }

    return new Promise((resolve, reject) => {
      const agentSrc = join(resourcesDir(), 'hermes-agent')
      const hermesHome = join(process.env.HOME || '', '.hermes')
      // P1-B3 #18: point bridge cwd to the workspace so hermes auto-loads
      // AGENTS.md, .cursorrules, etc. from the project directory.
      let workspaceDir: string
      try {
        workspaceDir = require('../vfs').getWorkspaceDir()
      } catch { workspaceDir = join(bridgeScript, '..') }
      this.buffer = ''

      // Fast-fail state: a bridge that dies during startup must reject NOW with
      // the reason, instead of leaving the user staring at a 30s timeout with no
      // diagnostics (ax sidecar.go:WaitUntilReady checks the process first).
      let settled = false
      let stderrTail = ''
      let timeout: ReturnType<typeof setTimeout> | undefined
      let check: ReturnType<typeof setInterval> | undefined
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (check) clearInterval(check)
        fn()
      }

      const proc = spawn(this.pythonBin!, [bridgeScript], {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          HERMES_HOME: hermesHome,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspaceDir,
      })
      this.proc = proc
      recordBridgePid(proc.pid)

      proc.stderr?.on('data', (d: Buffer) => {
        const text = d.toString().trim()
        stderrTail = (stderrTail + '\n' + text).slice(-800)
        console.error('[DeskApp Engine]', text)
      })

      proc.stdout?.on('data', (d: Buffer) => {
        // Ignore output from a stale (killed/replaced) process
        if (this.proc !== proc) return
        this.buffer += d.toString()
        this.parseLines()
      })

      proc.on('exit', (code) => {
        console.log(`[DeskApp Engine] process exited (code ${code})`)
        if (!settled) {
          // Died while starting: surface why (python missing deps, bad config…)
          this.proc = null
          this.state = 'idle'
          this.buffer = ''
          settle(() => reject(new Error(
            `Bridge exited during startup (code ${code})${stderrTail ? ': ' + stderrTail.trim().split('\n').slice(-3).join(' | ') : ''}`,
          )))
          return
        }
        // STALE GUARD: if this process was already killed/replaced (killBridge
        // sets this.proc = null, or a new spawn replaced it), ignore this exit.
        // Without this guard, a late exit event from an aborted bridge would
        // fail the NEXT task with "Bridge exited".
        if (this.proc !== proc) return
        // Genuine unexpected crash of the CURRENT bridge
        if (this.state === 'running' && this.taskDone) {
          this.taskDone(false, `Bridge exited unexpectedly (code ${code})`)
          // P0-5: inbox — surface the crash to the pet badge + panel
          try {
            const { addItem } = require('../inbox')
            addItem({ kind: 'agent-offline', title: translate(da(), 'notify.engineDown'), preview: `exit code ${code}`, toolCallId: `exit-${Date.now()}` })
          } catch { /* inbox not initialized yet */ }
        }
        this.clearPendingApprovals('abort')  // Phase 6: crash invalidates cards
        this.proc = null
        this.state = 'idle'
        this.buffer = ''
      })

      proc.on('error', (err) => {
        console.error('[DeskApp Engine] spawn error:', err.message)
        if (this.proc === proc) {
          this.proc = null
          this.state = 'error'
        }
        settle(() => reject(err))
      })

      // Wait for 'ready' signal
      timeout = setTimeout(() => {
        this.killBridge()
        this.state = 'error'
        settle(() => reject(new Error('Bridge start timeout (30s)')))
      }, 30000)
      check = setInterval(() => {
        if (this.state === 'ready') settle(() => resolve())
      }, 50)
    })
  }

  /** Parse JSON lines from bridge stdout, dispatch events to active callbacks */
  private parseLines(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = parseFrame(line)
        if (!parsed.ok) {
          // Unsupported version = a stale main process talking to a newer
          // bridge: surface it once instead of silently mis-reading frames.
          if (parsed.reason === 'unsupported-version' && !this.protocolWarned) {
            this.protocolWarned = true
            console.error('[DeskApp Engine] bridge protocol mismatch:', parsed.detail, '— restart the app')
            try { require('../deadletter').pushDeadLetter('bridge', 'protocol version mismatch', parsed.detail) } catch { /* not initialized */ }
          } else if (parsed.reason !== 'unsupported-version' && parsed.reason !== 'no-type') {
            console.warn('[DeskApp Engine] unparseable bridge line:', parsed.reason)
          }
          continue
        }
        const ev = parsed.frame
        switch (ev.type) {
          case 'ready':
            this.state = 'ready'
            this.flushContext()
            // forward provider info if available
            if (ev.active_provider || ev.active_model) {
              this.cbs?.onProviderInfo?.({
                provider: ev.active_provider,
                model: ev.active_model,
                providers: ev.providers || [],
              })
            }
            break
          case 'warm':
            console.log('[DeskApp Engine] prefix cache primed — first question will be fast')
            break
          case 'text':
            this.accumulatedText += (ev.content || '')
            this.cbs?.onChunk?.(ev.content || '')
            this.lastHeartbeat = Date.now()
            break
          case 'reasoning':
            this.cbs?.onReasoning?.(ev.content || '')
            this.lastHeartbeat = Date.now()
            break
          case 'reasoning_end':
            // Explicit thinking-block boundary from the bridge — the renderer
            // no longer has to infer it from the next text delta.
            this.cbs?.onReasoningEnd?.()
            break
          case 'tool_start':
          case 'tool_call':
            this.cbs?.onToolCall?.(ev.name || 'tool', ev.args || '{}')
            this.auditLog('tool_start', ev.name, ev.args)
            break
          case 'tool_result':
            this.cbs?.onToolResult?.(ev.name || '', ev.content || '')
            this.auditLog('tool_result', ev.name, ev.content)
            break
          case 'token_usage':
            this.cbs?.onTokens?.({
              promptTokens: ev.prompt_tokens || 0,
              completionTokens: ev.completion_tokens || 0,
              totalTokens: ev.total_tokens || 0,
              cacheReadTokens: ev.cache_read_tokens || 0,
              cacheWriteTokens: ev.cache_write_tokens || 0,
              reasoningTokens: ev.reasoning_tokens || 0,
              contextTokens: ev.context_tokens || undefined,
            })
            break
          case 'done': {
            // bridge v2 includes metadata in done event.
            // Snapshot cbs BEFORE taskDone() — taskDone nulls this.cbs, which
            // used to silently drop the turn metadata (model/provider) below.
            const doneCbs = this.cbs
            if (ev.error) {
              this.taskDone?.(false, ev.error)
            } else {
              this.taskDone?.(true)
            }
            // forward extra metadata
            if (ev.elapsed_ms !== undefined) {
              doneCbs?.onDoneMeta?.({
                sessionId: ev.session_id || '',
                elapsedMs: ev.elapsed_ms || 0,
                apiCalls: ev.api_calls || 0,
                chunks: ev.chunks || 0,
                completed: ev.completed !== false,
                model: ev.model || undefined,
                provider: ev.provider || undefined,
              })
            }
            break
          }
          case 'error': {
            const code = errorCodeOf(ev)
            const msg = ev.message || 'Error'
            // Route by code: config mistakes are a bug in what we sent the
            // bridge (dead-letter it so it is visible), everything else is
            // surfaced to the turn as before.
            if (code === 'invalid_config') {
              try { require('../deadletter').pushDeadLetter('bridge-event', `invalid_config: ${msg}`, JSON.stringify(ev).slice(0, 500)) } catch { /* not initialized */ }
              console.error('[DeskApp Engine] invalid_config from bridge:', msg)
            } else if (code === 'no_credentials') {
              console.error('[DeskApp Engine] no_credentials from bridge — provider key missing')
            }
            this.taskDone?.(false, code === 'internal' ? msg : `[${code}] ${msg}`)
            break
          }
          case 'permission_required': {
            // Phase 6: bridge approval callback is blocking a tool thread —
            // surface the card to the renderer and count as bridge activity.
            const req: PermissionRequest = {
              id: String(ev.id || ''),
              command: String(ev.command || ''),
              description: String(ev.description || ''),
              allowPermanent: ev.allow_permanent !== false,
              smartDenied: ev.smart_denied === true,
            }
            // #12: attach risk class so the renderer picks compact/full layout
            try { (req as any).risk = require('./risk').classifyTool('terminal', req.command) } catch { /* optional */ }
            if (req.id) {
              this.pendingApprovals.set(req.id, req)
              this.lastHeartbeat = Date.now()
              this.cbs?.onPermissionRequired?.(req)
            }
            break
          }
          case 'health': {
            // The bridge's watchdog keeps these coming while a turn is in flight
            // (even when the agent produces nothing) — this is what makes "long
            // tool run" distinguishable from "wedged" on this side. Only the
            // first "still waiting for the provider" frame is worth a log line.
            this.lastHeartbeat = Date.now()
            const phase = String(ev.phase || 'running')
            if (phase !== 'running' && !this.firstTokenWarned) {
              this.firstTokenWarned = true
              console.warn(`[DeskApp Engine] bridge health: ${phase} (${Math.round(Number(ev.silent_s) || 0)}s without output)`)
            }
            break
          }
          case 'auto_approved': {
            // cron / automation runs (auto_approve=1) auto-allow tool calls
            // because nobody is watching the bubble. Record them: the frame is
            // the ONLY trace (no card, and the timeout path never fires).
            // Audit log + console, deliberately not the inbox — one job can
            // approve dozens of calls and the inbox would become noise.
            const cmd = String(ev.command || '')
            console.log('[DeskApp] auto-approved (unattended):', cmd.slice(0, 120))
            this.auditLog('auto_approved', cmd.slice(0, 200), String(ev.description || ''))
            break
          }
          case 'permission_timeout': {
            const id = String(ev.id || '')
            const pending = this.pendingApprovals.get(id)
            if (id && this.pendingApprovals.delete(id)) {
              this.lastHeartbeat = Date.now()
              this.cbs?.onPermissionResolved?.(id, 'timeout')
              // Phase 6 Step 4: 无人响应 → 落 inbox（宠物角标自动联动）
              try {
                const { addItem } = require('../inbox')
                addItem({
                  kind: 'approval',
                  title: translate(da(), 'notify.dangerTimeout'),
                  preview: (pending?.command || '').slice(0, 120),
                  toolCallId: id,
                  visibility: 'inbox',
                })
              } catch { /* inbox not initialized yet */ }
            }
            break
          }
          case 'question_required': {
            // #33: hermes clarify tool blocks until the user answers the card
            const req: QuestionRequest = {
              id: String(ev.id || ''),
              question: String(ev.question || ''),
              choices: Array.isArray(ev.choices) ? ev.choices.map(String) : [],
            }
            if (req.id) {
              this.pendingQuestions.set(req.id, req)
              this.lastHeartbeat = Date.now()
              this.cbs?.onQuestionRequired?.(req)
            }
            break
          }
          case 'question_timeout': {
            const id = String(ev.id || '')
            if (id && this.pendingQuestions.delete(id)) {
              this.cbs?.onQuestionResolved?.(id, 'timeout')
            }
            break
          }
          case 'selfwake_request': {
            // #21: deskapp_wake tool → one-shot cron entry
            try {
              require('../cron').addOneShot(Number(ev.wake_at || 0), String(ev.task || ''), String(ev.reason || ''))
            } catch { /* cron store unavailable */ }
            break
          }
          case 'genui_request': {
            // deskapp_genui tool → materialize/update/run/stop/remove spec windows
            try {
              require('../gen-ui').handleAgentRequest(ev)
            } catch (e) { console.error('[genui] request failed:', e) }
            break
          }
          case 'scheduler_request': {
            // deskapp_scheduler tool → 日程/会议/项目/任务 CRUD + today 汇总
            try {
              const sch = require('../scheduler')
              const { action, id, event, task, project, date } = ev
              if (action === 'create_event') sch.createEvent(event)
              else if (action === 'update_event') sch.updateEvent(id, event || {})
              else if (action === 'delete_event') sch.deleteEvent(id)
              else if (action === 'create_task') sch.createTask(task)
              else if (action === 'update_task') sch.updateTask(id, task || {})
              else if (action === 'delete_task') sch.deleteTask(id)
              else if (action === 'create_project') sch.createProject(project)
              else if (action === 'today') {
                // 早晨问答: 打开 Scheduler 窗口让用户看完整视图
                try { require('../scheduler-window').openSchedulerWindow() } catch { /* window unavailable */ }
              }
            } catch (e) { console.error('[scheduler] request failed:', e) }
            break
          }
          case 'screen_request': {
            // deskapp_screen tool → L1 原生桥: 操控其他桌面应用
            try {
              const sc = require('../screen-control')
              const { action, app } = ev
              if (action === 'list') void sc.listApps()
              else if (action === 'perm') void sc.permStatus()
              else if (action === 'open') void sc.openApp(app)
              else if (action === 'activate') void sc.activateApp(app)
              else if (action === 'quit') void sc.quitApp(app)
            } catch (e) { console.error('[screen] request failed:', e) }
            break
          }
          default: {
            // D2 #45: bridge emitted an event type nobody consumes — dead-letter it
            try {
              require('../deadletter').pushDeadLetter('bridge-event',
                `unhandled bridge event: ${String(ev.type)}`, line.slice(0, 400))
            } catch { /* deadletter unavailable */ }
          }
        }
      } catch { /* skip malformed lines */ }
    }
  }

  /** Bootstrap Python + hermes-agent via embedded uv */
  private async bootstrapPython(): Promise<void> {
    const { app } = require('electron')
    const uv = join(resourcesDir(), 'uv', 'uv')
    const agentSrc = join(resourcesDir(), 'hermes-agent')

    if (!existsSync(uv) || !existsSync(join(agentSrc, 'run_agent.py'))) {
      throw new Error('Embedded agent bundle not found')
    }

    const venvDir = join(app.getPath('userData'), 'deskapp-agent-venv')
    const markerPath = join(venvDir, '.bundle-version')
    const pythonBin = join(venvDir, 'bin', 'python3')
    // Bundle fingerprint: mtime+size of the agent entrypoint. Re-running
    // `uv venv` + `uv pip install -e` on every launch costs 5-15s and rewrites
    // the venv for nothing when the bundle did not change (ax setup.go skips
    // extraction when the destination already matches).
    const want = ((): string => {
      try {
        const st = statSync(join(agentSrc, 'run_agent.py'))
        return `${st.mtimeMs}-${st.size}`
      } catch { return 'unknown' }
    })()
    if (existsSync(pythonBin) && existsSync(markerPath)) {
      try {
        if (readFileSync(markerPath, 'utf-8').trim() === want && want !== 'unknown') {
          console.log('[DeskApp] agent venv up to date — skipping bootstrap')
          this.pythonBin = pythonBin
          return
        }
      } catch { /* marker unreadable → rebuild */ }
    }

    // Create venv
    await this.execWithTimeout(
      spawn(uv, ['venv', '--python', '3.12', venvDir], {
        env: { ...process.env, UV_NO_PROGRESS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      120000,
    )

    // Install agent
    await this.execWithTimeout(
      spawn(uv, ['pip', 'install', '--python', pythonBin, '-e', agentSrc], {
        env: { ...process.env, UV_NO_PROGRESS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      300000,
    )

    try { writeFileSync(markerPath, want) } catch { /* best effort */ }
    this.pythonBin = pythonBin
  }

  private execWithTimeout(cp: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      cp.stderr?.on('data', (d: Buffer) => {
        console.log('[DeskApp Bootstrap]', d.toString().trim())
      })
      cp.on('exit', (code) => {
        code === 0 ? resolve() : reject(new Error(`Exit ${code}`))
      })
      cp.on('error', reject)
      setTimeout(() => { cp.kill(); reject(new Error('bootstrap timeout')) }, timeoutMs)
    })
  }
}

// ── AgentExecutor wrapper ──

export class DesktopAgentExecutor implements AgentExecutor {
  readonly name = 'desktop-agent'
  private bridge: DesktopAgentBridge = new DesktopAgentBridge()

  async execute(task: string, cbs: TaskStreamCallbacks): Promise<AbortHandle> {
    return this.bridge.execute(task, cbs)
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (this.bridge.isAlive()) return true
      const agentSrc = join(resourcesDir(), 'hermes-agent')
      return existsSync(join(agentSrc, 'run_agent.py'))
    } catch {
      return false
    }
  }

  async prewarm(): Promise<void> {
    console.log('[DeskApp] Pre-warming DeskApp Engine...')
    try {
      await this.bridge.start()
      console.log('[DeskApp] DeskApp Engine ready')
    } catch (err) {
      console.log('[DeskApp] Embedded agent not available:', (err as Error).message)
    }
  }

  shutdown(): void {
    this.bridge.shutdown()
  }

  spec(): RunnerSpec {
    return {
      id: 'desktop-agent',
      launch: { kind: 'child-process', command: 'python3 resources/bridge.py', args: [] },
      ready: 'stdio-frame',
      protocol: { lang: 'jsonl', version: PROTOCOL_VERSION },
      workspace: 'workspace-dir',
      debugAttach: false,
    }
  }
}

/** Singleton executor instance */
export const desktopAgentExecutor = new DesktopAgentExecutor()

// ── BridgeManager: one bridge process per bubble window ──
//
// Mirrors the "hermes CLI in N terminals" model: each bubble gets its own
// python bridge process with independent AIAgent + conversation history.
// Tasks from different bubbles run FULLY CONCURRENTLY.
//
// Spare-bridge pattern: one pre-warmed bridge is kept in reserve. A new
// bubble instantly adopts the spare (no 5-15s agent-creation delay), and a
// fresh spare warms up in the background for the NEXT bubble.

export class BridgeManager {
  private bridges = new Map<string, DesktopAgentBridge>()
  private spare: DesktopAgentBridge | null = null
  private spareWarming = false

  /** Warm up a spare bridge in the background */
  private makeSpare(): void {
    if (this.spare || this.spareWarming) return
    this.spareWarming = true
    const b = new DesktopAgentBridge()
    b.start()
      .then(() => {
        this.spare = b
        this.spareWarming = false
        console.log('[DeskApp] Spare bridge ready')
      })
      .catch((err) => {
        this.spareWarming = false
        console.log('[DeskApp] Spare bridge warm-up failed:', (err as Error).message)
      })
  }

  /** Called at app startup */
  prewarm(): void {
    reapOrphanBridges()
    this.makeSpare()
  }

  /** Get or create the bridge for a bubble (keyed by webContents id).
   *  Default `reapable=false`: a window-owned bridge is never reaped by the
   *  memory guard (standing requirement — an open bubble stays warm). Only
   *  background jobs (cron / gen-ui) opt in with `true`. */
  private getBridge(key: string, reapable = false): DesktopAgentBridge {
    let b = this.bridges.get(key)
    if (!b) {
      if (this.spare) {
        // Adopt the pre-warmed spare — instant response
        b = this.spare
        this.spare = null
        console.log('[DeskApp] Bubble', key, 'adopted spare bridge')
      } else {
        b = new DesktopAgentBridge()
        console.log('[DeskApp] Bubble', key, 'created new bridge')
      }
      this.bridges.set(key, b)
      // Warm the next spare for the next bubble
      this.makeSpare()
    }
    this.reapable.set(key, this.reapable.has(key) ? this.reapable.get(key)! : reapable)
    this.touch(key)
    return b
  }

  /** Execute a task on the bubble's own bridge (concurrent across bubbles).
   *  `reapable=true` = background job (cron / gen-ui), reclaimable under pressure. */
  async execute(key: string, task: string, cbs: TaskStreamCallbacks, modelOverride?: { model: string; provider: string }, reapable = false): Promise<AbortHandle> {
    return this.getBridge(key, reapable).execute(task, cbs, modelOverride)
  }

  /** True when the bubble's bridge has a task running or queued behind it. */
  isBusy(key: string): boolean {
    return this.bridges.get(key)?.isBusy() ?? false
  }

  /** Phase 6: forward a permission response to the bubble's bridge.
   *  Returns false when the bridge or the pending id is unknown. */
  respondPermission(key: string, id: string, outcome: 'once' | 'session' | 'always' | 'deny'): boolean {
    const b = this.bridges.get(key)
    return b ? b.respondPermission(id, outcome) : false
  }

  /** #33: forward a question answer to the bubble's bridge. */
  respondQuestion(key: string, id: string, answer: string): boolean {
    const b = this.bridges.get(key)
    return b ? b.respondQuestion(id, answer) : false
  }

  /** Sync an externally-executed turn (task-tree) into the bridge's history
   *  history so follow-up turns share context. */
  injectContext(key: string, user: string, assistant: string): void {
    this.getBridge(key).injectContext(user, assistant)
  }

  /** Pre-warm the bubble's bridge in the background — call when a tree task
   *  starts so the follow-up simple turn hits a warm bridge. */
  warm(key: string, reapable = false): void {
    this.getBridge(key, reapable).warmup()
  }

  /** P1-B3: Verify provider connectivity — spawn a temp bridge and measure
   *  TTFT on a minimal ping task. Throws on timeout/failure. */
  async ping(key: string): Promise<void> {
    const bridge = this.getBridge(key)
    await bridge.start()
    // Send a minimal task and wait for first output
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ping timeout (15s)'))
      }, 15_000)
      bridge.execute('Reply with a single word: ok', {
        onChunk: () => {
          clearTimeout(timeout)
          resolve()
        },
        onDone: () => { clearTimeout(timeout); resolve() },
        onError: (e) => { clearTimeout(timeout); reject(new Error(e)) },
      }).catch(reject)
    })
  }

  /** Bubble window closed → kill its bridge */
  dispose(key: string): void {
    const b = this.bridges.get(key)
    if (b) {
      b.shutdown()
      this.bridges.delete(key)
      this.lastUsed.delete(key)
      console.log('[DeskApp] Bubble', key, 'bridge disposed')
    }
  }

  // ── Memory policy ──
  // A live bridge is ~135MB resident. bubble()/cron()/gen-ui keys are cheap to
  // re-create (5-15s cold start) compared to holding a hung 135MB process for
  // the rest of the session, so idle ones get reaped and the live count capped.

  /** epoch ms per key (creation/adoption/last execute) */
  private lastUsed = new Map<string, number>()

  /** false = owned by an open window → memory guard must not reap it */
  private reapable = new Map<string, boolean>()

  private touch(key: string): void { this.lastUsed.set(key, Date.now()) }

  /** Live bridge keys with their busy flag + last use, oldest first. */
  stats(): BridgeStat[] {
    return [...this.bridges.entries()]
      .map(([key, b]) => ({
        key,
        busy: b.isBusy(),
        lastUsedAt: this.lastUsed.get(key) ?? 0,
        pinned: this.reapable.get(key) === false,
      }))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  }

  /** Rough resident cost of all live bridges (measurement-based, see BRIDGE_MB). */
  estimatedMemoryMB(): number {
    return (this.bridges.size + (this.spare ? 1 : 0)) * BRIDGE_MB
  }

  /** Dispose idle/over-budget unpinned bridges. Returns the keys reaped.
   *  `maxIdleMs: 0` = memory pressure, drop every unpinned non-busy bridge. */
  reapIdle(opts: { maxIdleMs?: number; maxLive?: number } = {}): string[] {
    const reaped = selectReaps(this.stats(), {
      now: Date.now(),
      maxIdleMs: opts.maxIdleMs ?? Infinity,
      maxLive: opts.maxLive ?? MAX_LIVE_BRIDGES,
    })
    for (const key of reaped) this.dispose(key)
    return reaped
  }

  /** Memory pressure: drop the warm spare too (next bubble pays a cold start). */
  dropSpare(reason: string): boolean {
    if (!this.spare) return false
    this.spare.shutdown()
    this.spare = null
    console.log('[DeskApp] spare bridge dropped:', reason)
    return true
  }

  /** App quit → kill everything */
  shutdownAll(): void {
    for (const b of this.bridges.values()) b.shutdown()
    this.bridges.clear()
    this.lastUsed.clear()
    this.reapable.clear()
    this.spare?.shutdown()
    this.spare = null
  }

  get activeCount(): number { return this.bridges.size }

  /** Live bridges including the warm spare — the unit mem-guard budgets in. */
  get totalCount(): number { return this.bridges.size + (this.spare ? 1 : 0) }

  /** OS-level view for the doctor check + memory guard (pids, busy state).
   *  Includes the warm spare: it is a live ~155MB process even though it has
   *  no owner key yet, and the guard must charge for it. `stats()` stays
   *  spare-free — reap policy handles the spare via dropSpare() instead. */
  processStats(): { key: string; pid: number | null; busy: boolean }[] {
    const out = this.stats().map((s) => {
      const b = this.bridges.get(s.key)
      return { key: s.key, pid: b?.pid() ?? null, busy: s.busy }
    })
    if (this.spare) out.push({ key: 'spare', pid: this.spare.pid() ?? null, busy: this.spare.isBusy() })
    return out
  }

  /** Interpreter paths of live bridges (first one is representative). */
  pythonPaths(): { key: string; python: string }[] {
    const out: { key: string; python: string }[] = []
    for (const [key, b] of this.bridges) {
      const py = b.python()
      if (py) out.push({ key, python: py })
    }
    return out
  }
}

/** Singleton bridge manager */
export const bridgeManager = new BridgeManager()

// ── Backward compat (for migration) ──

/** @deprecated Use desktopAgentExecutor.execute() instead */
export async function executeTask(task: string, cbs: TaskStreamCallbacks): Promise<void> {
  await desktopAgentExecutor.execute(task, cbs)
}
