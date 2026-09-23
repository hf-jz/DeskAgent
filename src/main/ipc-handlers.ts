import { ipcMain, BrowserWindow, app, shell } from 'electron'
import { join, basename } from 'path'
import { homedir } from 'os'
import { existsSync, unlinkSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import type { PetWindow } from './pet-window'
import type { HitWindow } from './hit-window'
import type { AgentManager } from './agents/manager'
import type { AbortHandle } from './agents/executor'
import type { TokenUsage, DoneMeta, AgentId } from './agents/types'
import type { PetSettings } from './settings-store'
import { needsSetup, readExistingConfig, PROVIDERS } from './setup-wizard'
import type { SkillIndexEntry } from './skill-hub/types'
import { bridgeManager, resourcesDir } from './agents/desktop-agent'
import { voiceBridge } from './voice-bridge'
import { hermesGatewayExecutor } from './agents/detect-hermes'
import { readWorkspaceProfile, workspaceRepoStatus } from './vfs'
import { acquireTurnSlot, queueStats } from './turn-queue'
import { classifyTask, WORKER_MODEL, WORKER_PROVIDER, PLANNER_MODEL } from './agents/task-router'
import { runTaskTree } from './agents/orchestrator'
import { buildTurnContext, buildSnapshot, buildCatalog, buildProfileBlock } from './agents/context'
import { getCapabilities } from './agents/capabilities'
import { handleIPC, onIPC, safeSend } from '../shared/ipc-main'
import { translate } from '../shared/locales'
import { getCreatePayload } from './create-window'
import { saveCustomPet, removeCustomPetFiles, getCustomPetUrl, getCustomPetSheetUrl, classifySubject } from './custom-pet'
import {
  initProject, readStatus, markAndNext, listArtifacts, openArtifact, openImg2ThreeJsWindow,
} from './img2threejs'
import type { SessionEntry, TaskTree } from '../shared/ipc-channels'

export interface IpcContext {
  petWindow: PetWindow | null
  hitWindow: HitWindow | null
  agentManager: AgentManager
  getSettings: () => PetSettings
  saveSettings: (s: PetSettings) => void
  applyPetSize: (size: 'S' | 'M' | 'L') => void
  openSettingsWindow: () => void
  openPetCustomizer: () => void
  showPetWindows: (pet: BrowserWindow | null | undefined, hit: BrowserWindow | null | undefined) => void
  doNewTask: () => void
  edgeToggle: () => void
  isQuitting: () => boolean
  setQuitting: (v: boolean) => void
  activeAborts: Map<number, AbortHandle>
  /** P0-2b: Steering queue — messages sent mid-task are queued and prepended to next turn */
  steeringQueue: Map<number, string[]>
  getEdgeState: () => string
  showFromEdge: () => void
}

// External functions injected from index.ts
let ctx: IpcContext

/** 界面语言（Settings > General）—— 主进程通知/文案跟随 */
function uiLang(): 'zh' | 'en' {
  try { return ctx?.getSettings()?.language === 'en' ? 'en' : 'zh' } catch { return 'zh' }
}

/** P0-1: active turn per webContents — lets 'agents:abort' emit a canonical
 *  turn.interrupted AgentEvent on paths where no callback fires (tree abort). */
const activeTurns = new Map<number, { emit: (e: any) => void; turnId: string }>()
// #12: turn-scoped grants — "allow every time" auto-answers the same command
// for the rest of the turn. Expires naturally: turnId must match the active turn.
const turnGrants = new Map<number, { turnId: string; commands: Set<string> }>()
// #35: one pending plan-confirmation resolver per bubble window
const pendingPlanConfirms = new Map<number, (ok: boolean) => void>()

// Lazy imports to avoid module-scope Electron API calls
function getSkillsStore() {
  return require('./skill-hub/store')
}
function getSkillsTranslator() {
  return require('./skill-hub/translator')
}
function getSessionStore() {
  return require('./session-store')
}
function getVfs() {
  return require('./vfs')
}
function getAgentStats() {
  return require('./agent-stats')
}
function getFileExplorer() {
  return require('./file-explorer')
}

export function registerAllHandlers(context: IpcContext): void {
  ctx = context

  // Leak guard: the three maps below are keyed by webContents id and written
  // during a turn, but nothing ever removed them — every closed bubble window
  // left its entry (plus the bus.emit closure / pending resolver) alive.
  app.on('web-contents-created', (_e, wc) => {
    const id = wc.id
    wc.once('destroyed', () => {
      activeTurns.delete(id)
      turnGrants.delete(id)
      // Resolve first: a dangling confirmPlan() await would otherwise pin the
      // whole turn context forever. false = "user declined".
      const pending = pendingPlanConfirms.get(id)
      pendingPlanConfirms.delete(id)
      try { pending?.(false) } catch { /* turn already gone */ }
    })
  })

  // Forward renderer console to main process
  onIPC('renderer:log', (_e, level, ...args) => {
    try { console.log(`[Renderer ${level}]`, ...args) } catch { /* EPIPE safe */ }
  })

  handleIPC('pet-bounds', () => ctx.petWindow?.win?.getBounds() ?? null)
  handleIPC('pet:click', () => ctx.doNewTask())
  handleIPC('pet:edge-toggle', () => ctx.edgeToggle())

  // ── Pet feeding: Finder 拖文件/文件夹到宠物身体 ──
  onIPC('pet:feed-hover', () => {
    const pet = ctx.petWindow?.win
    if (pet && !pet.isDestroyed()) {
      pet.webContents.send('pet:say', translate(uiLang(), 'feed.hover'), 60000)
    }
  })
  onIPC('pet:feed-leave', () => {
    const pet = ctx.petWindow?.win
    if (pet && !pet.isDestroyed()) pet.webContents.send('pet:say', '', 0)
  })
  onIPC('pet:feed', (_e, paths: string[]) => {
    try {
      const { feedFiles } = require('./feed')
      feedFiles(paths, ctx.petWindow?.win ?? null, join(__dirname, '../preload/index.js'))
    } catch (err) { console.log('[DeskApp] feed failed:', (err as Error).message) }
  })
  // 气泡内清单编辑：重建 payload（增删后刷新 stat/目录树） / 文件夹拆一层
  handleIPC('feed:build', (_e, paths: string[]) => {
    try { return require('./feed').buildFeedPayload(paths) } catch (err) { console.log('[DeskApp] feed:build failed:', (err as Error).message); return { items: [], summary: '', statText: '', petBounds: { x: 0, y: 0, width: 0, height: 0 } } }
  })
  handleIPC('feed:expand', (_e, path: string) => {
    try { return require('./feed').expandFolder(path) } catch (err) { console.log('[DeskApp] feed:expand failed:', (err as Error).message); return [] }
  })

  // Audit log handler lives near the bottom of this file (multi-day version);
  // a duplicate registration here crashed boot with EBUSY-handler errors.

  // Context menu
  handleIPC('pet:context-menu', () => {
    if (!ctx.petWindow?.win) return
    const { showPetContextMenu } = require('./context-menu')
    showPetContextMenu(
      ctx.petWindow.win, ctx.doNewTask, () => ctx.openSettingsWindow(),
      () => { ctx.setQuitting(true); app.quit() }, () => ctx.isQuitting(),
      () => {
        if (ctx.hitWindow?.win && !ctx.hitWindow.win.isDestroyed()) {
          ctx.hitWindow.win.moveTop()
        }
      },
    )
  })

  // Settings
  handleIPC('settings:get', () => ctx.getSettings())
  handleIPC('open-pet-customizer', () => ctx.openPetCustomizer())
  handleIPC('custom-pet:png-url', (_e, id) => {
    const info = (ctx.getSettings().customPets ?? []).find((p) => p.id === id)
    return getCustomPetUrl(info)
  })
  handleIPC('custom-pet:sheet-url', (_e, id) => {
    const info = (ctx.getSettings().customPets ?? []).find((p) => p.id === id)
    return getCustomPetSheetUrl(info)
  })
  handleIPC('custom-pet:list', () => ctx.getSettings().customPets ?? [])

  // Custom pet: photo → desktop pet asset (save persists + activates, remove deletes + falls back)
  handleIPC('custom-pet:save', (_e, dataUrl, sheetDataUrl, name) => {
    const info = saveCustomPet(dataUrl, sheetDataUrl, name)
    const s = ctx.getSettings()
    const library = [info, ...(s.customPets ?? [])]
    const next = { ...s, customPet: info, customPets: library, petStyle: 'custom' as const }
    ctx.saveSettings(next)
    for (const w of BrowserWindow.getAllWindows()) {
      safeSend(w.webContents, 'settings-changed', next)
    }
    return info
  })
  handleIPC('custom-pet:remove', (_e, id) => {
    const s = ctx.getSettings()
    const target = (s.customPets ?? []).find((p) => p.id === id)
    if (target) removeCustomPetFiles(target)
    const library = (s.customPets ?? []).filter((p) => p.id !== id)
    const wasActive = s.customPet?.id === id
    const next: typeof s = {
      ...s,
      customPets: library,
      customPet: wasActive ? undefined : s.customPet,
      petStyle: wasActive ? ('strands' as const) : s.petStyle,
    }
    ctx.saveSettings(next)
    for (const w of BrowserWindow.getAllWindows()) {
      safeSend(w.webContents, 'settings-changed', next)
    }
  })
  handleIPC('custom-pet:classify', async (_e, dataUrl, nameHint) => classifySubject(dataUrl, nameHint))

  // img2threejs forge console
  handleIPC('img2threejs:open', () => openImg2ThreeJsWindow())
  handleIPC('img2threejs:init', async (_e, reference, projectName, profile) => initProject(reference, projectName, profile || 'generic'))
  handleIPC('img2threejs:status', async (_e, projectDir) => readStatus(projectDir))
  handleIPC('img2threejs:mark', async (_e, projectDir, step) => markAndNext(projectDir, step))
  handleIPC('img2threejs:artifacts', (_e, projectDir) => listArtifacts(projectDir))
  handleIPC('img2threejs:open-artifact', (_e, path) => openArtifact(path))
  handleIPC('settings:update', (_e, updates) => {
    const prevSize = ctx.getSettings().size
    const newSettings = { ...ctx.getSettings(), ...updates }
    ctx.saveSettings(newSettings)
    if (updates.size && updates.size !== prevSize) ctx.applyPetSize(updates.size)
    // P0-3: user tool-risk overrides take effect immediately
    if (updates.toolRiskOverrides !== undefined) {
      try { require('./agents/risk').setRiskOverrides(newSettings.toolRiskOverrides || []) } catch { /* risk module unavailable */ }
    }
    // Broadcast to ALL windows (pet + bubble + settings) — theme changes and
    // risk/grant visibility must propagate beyond the pet window.
    for (const w of BrowserWindow.getAllWindows()) {
      safeSend(w.webContents, 'settings-changed', newSettings)
    }
    return newSettings
  })
  handleIPC('settings:update-models', (_e, plannerModel, workerModel) => {
    const { updateModelNames } = require('./setup-wizard')
    const { updateModelIdentities } = require('./agents/task-router')
    updateModelNames(plannerModel, workerModel)
    updateModelIdentities(workerModel, plannerModel)
    return { ok: true, plannerModel, workerModel }
  })

  // Agent task execution
  // P1-B3: track per-session snapshot sent state (Set resets on restart —
  // each session gets a fresh snapshot on its first post-restart turn).
  const sentSnapshots = new Set<string>()

  handleIPC('agents:execute-task', async (event, task, options) => {
    const modelMode = options?.modelMode ?? 'auto'
    const sessionId = options?.sessionId ?? `anon-${Date.now()}`
    console.log('[DeskApp] IPC execute-task received:', task.substring(0, 50), `[mode=${modelMode}]`)

    const wc = event.sender
    const workspace = (() => { try { return require('./vfs').getWorkspaceDir() } catch { return process.cwd() } })()

    // Bridge executes tasks serially per window — if a previous turn is still
    // running, this message queues behind it. Tell the bubble so it doesn't
    // sit on a silent "thinking…" (the queue drains once the running task
    // finishes; same-window key, see execute below).
    if (bridgeManager.isBusy(String(wc.id))) {
      try { wc.send('task:queued', 1) } catch { /* window closing */ }
    }

    // ---- Gather context segments ----

    // Habit context
    let habitCtx = ''
    try {
      const habitService = require('./habit/habit-service')
      habitCtx = habitService.getContextText(task) || ''
    } catch { /* habit engine unavailable */ }

    // Steering queue
    const queue = ctx.steeringQueue.get(wc.id) || []
    const steeringMessages = [...queue]
    if (queue.length > 0) ctx.steeringQueue.set(wc.id, [])

    // First-turn snapshot
    const isFirstTurn = !sentSnapshots.has(sessionId)

    // Memory recall
    let memoryText = ''
    try {
      const { recall, formatForContext } = require('./memory/store')
      const globalEntries = recall('global') || []
      const wsEntries = workspace ? recall('workspace', workspace) : []
      const sessionEntries = recall('session', workspace, sessionId)
      const allEntries = [...globalEntries, ...wsEntries, ...sessionEntries]
      if (allEntries.length > 0) memoryText = formatForContext(allEntries)
    } catch { /* memory store unavailable */ }

    // Skill catalog
    let catalogText = ''
    try {
      const skillStore = require('./skill-hub/store')
      const skills = (skillStore.listSkills() || [])
        .filter((s: any) => s.active && s.activeFor?.includes('hermes'))
        .slice(0, 30)
      if (skills.length > 0) catalogText = buildCatalog(skills)
    } catch { /* skill hub unavailable */ }

    // Environment snapshot (first turn only) — plus the workspace profile, so
    // the agent knows what this environment is for and what is still missing.
    let snapshotText = ''
    if (isFirstTurn) {
      const profile = readWorkspaceProfile()
      snapshotText = buildSnapshot(workspace)
      const block = buildProfileBlock(profile, workspaceRepoStatus(profile))
      if (block) snapshotText += `\n\n${block}`
      sentSnapshots.add(sessionId)
    }

    // ---- Build the prompt ----
    const taskForModel = buildTurnContext(
      { task, sessionId, workspace, isFirstTurn, steeringMessages, habitCtx },
      { snapshot: snapshotText, catalog: catalogText, memory: memoryText },
    )

    // P0-1: unified event stream — every turn gets an id and a turn.start;
    // bridge/orchestrator callbacks are wrapped to emit canonical AgentEvents
    // alongside the legacy channels (renderers migrate at their own pace).
    const { createEventBus, wrapBridgeCallbacks, createOrchestratorAdapters, newTurnId } = require('./agents/event-bus')
    const bus = createEventBus(wc)
    const turnId: string = newTurnId()
    bus.setTurnId(turnId)
    activeTurns.set(wc.id, { emit: bus.emit, turnId })
    // Global turn slot (turn-queue.ts) is released when the turn reaches a
    // terminal callback — bridgeManager.execute() resolves as soon as the task
    // is written to the bridge, long before the turn is actually over.
    // `handedOff` marks that a backend owns the turn: from then on only its
    // terminal callback (or the watchdog) may release the slot.
    // Object-property storage: TS flow analysis can't narrow closure writes.
    const turnSlotRef: { end: (() => void) | null; handedOff: boolean } = { end: null, handedOff: false }
    const cbs = wrapBridgeCallbacks(bus, {
      onChunk: (t: string) => {
        safeSend(wc, 'task:chunk', t)
        // ponytail: feed agent delta to voice TTS sentence splitter
        try { voiceBridge.feedDelta(t) } catch {}
      },
      onDone: () => {
        ctx.activeAborts.delete(wc.id) // stale handle must not abort the NEXT send
        safeSend(wc, 'task:done')
        try { voiceBridge.flushDelta() } catch {}
        turnSlotRef.end?.() // release the global turn slot — only now is the turn really over
      },
      onError: (e: string) => {
        ctx.activeAborts.delete(wc.id)
        safeSend(wc, 'task:error', e)
        try { voiceBridge.flushDelta() } catch {}
        turnSlotRef.end?.()
      },
      onInterrupted: (partial: string) => {
        ctx.activeAborts.delete(wc.id)
        safeSend(wc, 'task:interrupted', partial)
        try { voiceBridge.interrupt() } catch {}
        turnSlotRef.end?.()
      },
      onReasoning: (t: string) => safeSend(wc, 'reasoning:chunk', t),
      onReasoningEnd: () => safeSend(wc, 'reasoning:end'),
      onToolCall: (name: string, args: string) => safeSend(wc, 'tool:call', name, args),
      onToolResult: (name: string, content: string) => safeSend(wc, 'tool:result', name, content),
      onTokens: (usage: TokenUsage) => safeSend(wc, 'token:usage', usage),
      onDoneMeta: (meta: DoneMeta) => safeSend(wc, 'turn:done-meta', meta),
      // Phase 6: approval card lifecycle
      onQuestionRequired: (req) => safeSend(wc, 'question:required', req),
      onQuestionResolved: (id, reason) => safeSend(wc, 'question:resolved', { id, reason }),
      onPermissionRequired: (req) => {
        // #12: turn grant hit → auto-answer 'once', card flashes and resolves
        const tg = turnGrants.get(wc.id)
        if (tg && tg.turnId === turnId && tg.commands.has(req.command)) {
          bridgeManager.respondPermission(String(wc.id), req.id, 'once')
          safeSend(wc, 'permission:required', req)
          safeSend(wc, 'permission:resolved', { id: req.id, reason: 'responded' })
          return
        }
        safeSend(wc, 'permission:required', req)
        // D2 #47: bubble not visible/focused → macOS notification with
        // Allow-once / Deny buttons wired straight into the permission chain.
        try {
          const win = BrowserWindow.fromWebContents(wc)
          if (!win || !win.isVisible() || !win.isFocused()) {
            const { Notification } = require('electron')
            const n = new Notification({
              title: translate(uiLang(), 'notify.approvalTitle'),
              body: (req.command || req.tool || '').slice(0, 120),
              actions: [
                { type: 'button', text: translate(uiLang(), 'notify.allowOnce') },
                { type: 'button', text: translate(uiLang(), 'notify.deny') },
              ],
              closeButtonText: translate(uiLang(), 'notify.later'),
            })
            n.on('action', (_e: unknown, idx: number) => {
              bridgeManager.respondPermission(String(wc.id), req.id, idx === 0 ? 'once' : 'deny')
            })
            n.on('click', () => { try { win?.show(); win?.focus() } catch { /* gone */ } })
            n.show()
          }
        } catch { /* notification unsupported (unsigned dev build) */ }
      },
      onPermissionResolved: (id, reason) => safeSend(wc, 'permission:resolved', { id, reason }),
    })

    ctx.activeAborts.get(wc.id)?.abort()
    const key = String(wc.id)
    // Brain mode routing:
    //   auto    → rule classifier: simple turns run on the cheap worker model
    //             inside the same bridge (history preserved across model
    //             switches); complex turns go to the planner task tree.
    //   worker  → pin every turn to deepseek-v4-pro (classifier + tree skipped)
    //   planner → pin every turn to kimi-k3 (classifier + tree skipped)
    const tier = modelMode === 'auto' ? classifyTask(task) : 'simple'
    console.log(`[DeskApp] Task tier: ${tier} (mode=${modelMode})`)
    // Tell the renderer which model this turn will run on — the status line
    // shows it DURING the reply instead of only after done-meta arrives.
    const startModel = modelMode === 'planner' ? PLANNER_MODEL
      : modelMode === 'worker' ? WORKER_MODEL
      : tier === 'complex' ? PLANNER_MODEL : WORKER_MODEL
    safeSend(wc, 'turn:start-meta', { model: startModel })
    bus.emit({ v: 1, turnId, ts: Date.now(), type: 'turn.start', payload: { meta: { model: startModel } } })

    // Global admission control (turn-queue.ts): a turn that reaches a backend
    // costs a bridge process (~135MB) — cap how many run at once so five
    // bubbles + cron can't spawn five bridges and wedge the app. Queued turns
    // reuse the existing "queued" notice the bubble already renders.
    const turnLabel = `bubble-${wc.id}`
    const tq0 = Date.now()
    const pending = acquireTurnSlot(turnLabel, () => {
      try { if (!wc.isDestroyed()) wc.send('task:queued', queueStats().waiting) } catch { /* closing */ }
    })
    // Aborting while queued must drop the queue entry, not a bridge that has
    // not started — registered before the wait, replaced by the real
    // AbortHandle once execution begins.
    ctx.activeAborts.set(wc.id, { abort: () => pending.cancel() } as AbortHandle)
    const tslot = await pending.wait
    if (!tslot) {
      console.log(`[DeskApp] queued turn cancelled before start (${turnLabel})`)
      return { success: false }
    }
    const waited = Date.now() - tq0
    if (waited > 200) console.log(`[DeskApp] turn waited ${waited}ms for a slot (${turnLabel})`)
    turnSlotRef.end = () => tslot.release()
    try {

    // Complex tasks → task-tree orchestration (方案 B): planner profile
    // decomposes into a tree, worker profile executes leaves, tree state
    // streams to the bubble. Falls back to the bridge when planning fails
    // or the goal isn't tree-worthy.
    if (tier === 'complex') {
      try {
        // Warm the bridge in the background while the tree runs (tree tasks
        // never touch the bridge) so a simple follow-up doesn't cold-start.
        bridgeManager.warm(key)
        // Accumulate the tree's final answer so the completed turn can be
        // synced into the bridge conversation history — without this the
        // bridge (which handles all simple follow-ups like "开始实施") has
        // never seen the tree task or its result, and context breaks.
        let treeAnswer = ''
        // Object-property storage: TS flow analysis can't narrow closure writes
        const treeRef: { current: TaskTree | null } = { current: null }
        const orchAdapters = createOrchestratorAdapters(bus, turnId)
        const orchCbs = {
          onChunk: (t: string) => { treeAnswer += t; cbs.onChunk(t) },
          onError: cbs.onError,
          onDone: cbs.onDone,
          onTree: (t: unknown) => { treeRef.current = t as TaskTree; orchAdapters.onTree(t as TaskTree); safeSend(wc, 'tree:update', t) },
          // #35: ask the user to confirm big plans before any node executes
          confirmPlan: (t: TaskTree) => new Promise<boolean>((resolve) => {
            pendingPlanConfirms.set(wc.id, resolve)
            safeSend(wc, 'plan:proposed', { tree: t })
          }),
        }
        const orch = runTaskTree(taskForModel, orchCbs)
        if (orch) {
          ctx.activeAborts.set(wc.id, { abort: orch.abort } as AbortHandle)
          turnSlotRef.handedOff = true
          const orchT0 = Date.now()
          const handled = await orch.handled
          if (handled) {
            console.log('[DeskApp] task-tree orchestration completed')
            if (treeAnswer.trim()) bridgeManager.injectContext(key, task, treeAnswer)
            // P0-5: surface failed tree nodes into the inbox — the turn may
            // "succeed" overall while individual nodes failed.
            try {
              const failed = treeRef.current?.nodes.filter(n => n.status === 'failed') || []
              if (failed.length > 0) {
                require('./inbox').addItem({
                  kind: 'tree-failed',
                  title: translate(uiLang(), 'notify.treeFailed', { n: failed.length }),
                  preview: failed.map(n => `${n.title}: ${(n.error || '').slice(0, 80)}`).join('；'),
                  toolCallId: turnId,
                })
              }
            } catch { /* inbox unavailable */ }
            // done-meta for tree turns — stamps the model badge on the reply
            // and feeds the status line (bridge turns get theirs from the bridge).
            if (!wc.isDestroyed()) safeSend(wc, 'turn:done-meta', { model: PLANNER_MODEL, elapsedMs: Date.now() - orchT0, via: '任务树' })
            return { success: true }
          }
          console.log('[DeskApp] orchestration declined, falling back to bridge planner')
        }
      } catch (e) {
        console.log('[DeskApp] orchestration error, falling back:', (e as Error).message)
      }
    }

    const useWorker = modelMode === 'worker' || (modelMode === 'auto' && tier === 'simple')
    const workerOverride = useWorker ? { model: WORKER_MODEL, provider: WORKER_PROVIDER } : undefined
    console.log(`[DeskApp] Route: ${workerOverride ? WORKER_MODEL : PLANNER_MODEL} (mode=${modelMode}, tier=${tier})`)
    try {
      // Active non-hermes agent (Settings→Agents) → its own CLI headless mode.
      // The CLI agent runs its own model + tools; hermes stays the default.
      const activeAgent = ctx.agentManager?.getState()?.activeAgentId
      if (activeAgent && activeAgent !== 'hermes') {
        const { CliAgentExecutor } = require('./agents/cli-executor')
        const handle = await new CliAgentExecutor(activeAgent).execute(taskForModel, cbs)
        ctx.activeAborts.set(wc.id, handle)
        turnSlotRef.handedOff = true
        return { success: true }
      }
      // Tree-decline/error fallback may have cleared the bus turnId — restore
      // it so bridge events are emitted under the same turn.
      if (!bus.turnId) bus.setTurnId(turnId)
      const handle = await bridgeManager.execute(key, taskForModel, cbs, workerOverride)
      ctx.activeAborts.set(wc.id, handle)
      turnSlotRef.handedOff = true
    } catch (err) {
      console.log('[DeskApp] Bridge failed, falling back to gateway:', (err as Error).message)
      try {
        const handle = await hermesGatewayExecutor.execute(taskForModel, cbs)
        ctx.activeAborts.set(wc.id, handle)
        turnSlotRef.handedOff = true
      } catch (err2) {
        cbs.onError('Agent unavailable: ' + (err2 as Error).message)
        return { success: false }
      }
    }
    return { success: true }
    } finally {
      // Only when nothing took the turn over (queued cancel, planner crash,
      // spawn failure). A handed-off turn releases in its terminal callback.
      if (!turnSlotRef.handedOff) tslot.release()
    }
  })

  onIPC('agents:abort', (_e) => {
    const wcId = _e.sender.id
    const handle = ctx.activeAborts.get(wcId)
    if (handle) { handle.abort(); ctx.activeAborts.delete(wcId) }
    // P0-2a: guarantee the renderer exits streaming state on EVERY abort path.
    // Bridge aborts signal via cbs.onInterrupted; orchestrator aborts never
    // call cbs — send here unconditionally (renderer handler is idempotent).
    safeSend(_e.sender, 'task:interrupted', '')
    // P0-1: canonical turn.interrupted for the event stream (tree path never
    // reaches a wrapped callback, so the bus would otherwise stay open).
    const at = activeTurns.get(wcId)
    if (at) at.emit({ v: 1, turnId: at.turnId, ts: Date.now(), type: 'turn.interrupted', payload: {} })
  })

  handleIPC('open-settings', () => ctx.openSettingsWindow())

  // Settings > Sessions: each click opens its OWN bubble window restored to
  // that session + injects its history into that window's bridge (agent memory).
  handleIPC('sessions:open', (_e, sid: string) => {
    try {
      const { createBubbleWindow } = require('./task-bubble')
      const win = createBubbleWindow(join(__dirname, '../preload/index.js'))
      win.show(); win.focus()
      win.webContents.send('session:restore', sid)
      const data = getSessionStore().loadSession(sid)
      const msgs = (data?.messages || []).filter((m: any) => m.kind === 'user' || m.kind === 'assistant')
      const key = String(win.webContents.id)
      let buf = ''
      for (const m of msgs) {
        if (m.kind === 'user') buf = m.content
        else if (buf) { bridgeManager.injectContext(key, buf, m.content); buf = '' }
      }
    } catch (err) { console.log('[DeskApp] sessions:open failed:', (err as Error).message) }
  })

  // Creation workspace (phase-1 MVP)
  handleIPC('create:open', (_e, p) => {
    try {
      const { createCreateWindow } = require('./create-window')
      createCreateWindow(join(__dirname, '../preload/index.js'), p)
    } catch (err) { console.log('[DeskApp] create:open failed:', (err as Error).message) }
  })
  handleIPC('create:sub-open', (_e, kind: string, source: string) => {
    try {
      const { createCreateSubWindow } = require('./create-window')
      createCreateSubWindow(join(__dirname, '../preload/index.js'), kind, source)
    } catch (err) { console.log('[DeskApp] create:sub-open failed:', (err as Error).message) }
  })
  handleIPC('create:scan', (_e, dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter(d => !d.name.startsWith('.'))
        .map(d => ({ name: d.name, path: join(dir, d.name), isDir: d.isDirectory() }))
    } catch { return [] }
  })
  handleIPC('create:read', (_e, path: string) => {
    try { return readFileSync(path, 'utf-8') } catch { return '' }
  })
  handleIPC('create:export', async (_e, p) => {
    try {
      const safe = p.title.replace(/[\\/:*?"<>|]/g, '_')
      const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // PPTX: dedicated venv (python-pptx) — blocks → slides, out beside the html.
      if (p.format === 'pptx') {
        const jsonPath = join(p.dir, `${safe}.blocks.json`)
        writeFileSync(jsonPath, JSON.stringify({ title: p.title, blocks: p.blocks }))
        const { spawnSync } = require('child_process')
        const pptxPath = join(p.dir, `${safe}.pptx`)
        const r = spawnSync(join(homedir(), '.hermes', 'pptx-venv', 'bin', 'python3'),
          [join(resourcesDir(), 'pptx-gen.py'), jsonPath, pptxPath], { timeout: 60_000 })
        if (r.status !== 0) { console.log('[DeskApp] pptx-gen failed:', String(r.stderr)); return '' }
        return pptxPath
      }
      const themeColor = p.themeColor || '#ff6a3d'
      // Render through personal-homepage-skill's presentation template:
      // extract its <style>/<script>, replace every .slide with the user's blocks —
      // structure, keyboard nav and the built-in edit mode all survive.
      // Registry lookup replaces the old hardcoded path.
      const { templateById } = require('../shared/create-registry')
      let html = ''
      if (p.templateId === 'react-deck') {
        const { buildReactDeck } = require('./create-deck')
        html = buildReactDeck(p.title, p.blocks, themeColor, p.themeFont)
      } else if (p.templateId === 'single-html') {
        // single-html homepage: swap the hero title + inject blocks as a card grid
        try { html = readFileSync(join(homedir(), 'web/personal-homepage-skill/templates/single-html/personal-homepage.html'), 'utf-8') } catch {}
        if (html.includes('<h1>')) {
          html = html.replace(/(<h1>)[\s\S]*?(<\/h1>)/, `$1${esc(p.title)}$2`)
          const cards = p.blocks.map(b => b.kind === 'image'
            ? `<div class="card" style="padding:0"><img src="file://${b.content}" style="width:100%;border-radius:8px"/></div>`
            : b.kind === 'table'
              ? `<div class="card"><h3>数据</h3><div style="overflow-x:auto">${p.blocks.length ? `<table style="border-collapse:collapse;font-size:13px"><tbody>${b.content.split('\n').slice(0, 20).map((l: string, i: number) => `<tr>${l.split(/[,，\t]/).map((c: string) => `<td style="border:1px solid rgba(255,255,255,.15);padding:4px 8px;${i === 0 ? 'font-weight:700' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}</div></div>`
              : `<div class="card"><h3>${esc(b.content.split('\n')[0].slice(0, 40))}</h3><p>${esc(b.content)}</p></div>`).join('')
          html = html.replace(/(<section id="projects")/, `<section class="section"><div class="grid">${cards}</div></section>\n$1`)
        }
      } else {
        const tplRel = templateById(p.templateId)?.path || 'web/personal-homepage-skill/templates/presentation-html/presentation.html'
        const tplPath = join(homedir(), tplRel)
      try { html = readFileSync(tplPath, 'utf-8') } catch { /* fall back below */ }
      if (html.includes('.slide')) {
        html = html.replace('--accent: #ff6a3d', `--accent: ${themeColor}`)
        const slides: string[] = []
        slides.push(`<section class="slide active"><p class="kicker">DESKAPP · CREATION</p><h1>${esc(p.title)}</h1><p class="lead">基于素材自动生成的展示 · 打开后点击左上角可编辑</p></section>`)
        p.blocks.forEach(b => {
          if (b.kind === 'image') {
            slides.push(`<section class="slide"><div style="display:grid;place-items:center;height:100%"><img src="file://${b.content}" style="max-width:86%;max-height:70vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.4)"/></div></section>`)
          } else if (b.kind === 'table') {
            const rows = b.content.split('\n').slice(0, 30).map(l => l.split(/[,，\t]/).map((c: string) => esc(c.replace(/^"|"$/g, '').trim()))).filter((r: string[]) => r.some(Boolean))
            const table = `<table style="border-collapse:collapse;width:100%;font-size:20px"><tbody>${rows.map((r: string[], i: number) => `<tr>${r.map((c: string) => `<td style="border:1px solid rgba(255,255,255,.15);padding:10px 16px;${i === 0 ? 'color:var(--accent);font-weight:700' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
            slides.push(`<section class="slide"><h2>${esc(b.content.split('\n')[0]?.slice(0, 40) || translate(uiLang(), 'deck.data'))}</h2><div style="margin-top:40px">${table}</div></section>`)
          } else if (b.kind === 'chart') {
            const { chartSvg } = require('../shared/chart-svg')
            slides.push(`<section class="slide"><h2>${esc((b.content.split('\n')[0] === 'line' ? translate(uiLang(), 'deck.trend') : translate(uiLang(), 'deck.data')) + '图表')}</h2><div style="margin-top:40px">${chartSvg(b.content)}</div></section>`)
          } else if (b.kind === 'component') {
            slides.push(`<section class="slide"><div style="display:grid;place-items:center;height:100%">${b.content}</div></section>`)
          } else {
            slides.push(`<section class="slide"><h2>${esc(b.content.split('\n')[0].slice(0, 40))}</h2><p class="lead">${esc(b.content)}</p></section>`)
          }
        })
        // Replace the whole template slide-run (any count) with the user's slides.
        const first = html.indexOf('<section class="slide')
        // lastEnd = the LAST slide's own closing tag (search FORWARD from the last
        // opening — a backward search lands on the previous slide's close and leaks it)
        const lastEnd = html.indexOf('</section>', html.lastIndexOf('<section class="slide')) + '</section>'.length
        if (first >= 0 && lastEnd > first) {
          html = html.slice(0, first) + slides.join('\n') + html.slice(lastEnd)
        }
      }
      if (!html.includes('.slide')) {
        // Fallback minimal deck (template missing)
        html = `<html><head><meta charset="utf-8"><style>body{font-family:-apple-system,'PingFang SC',sans-serif;background:#0b0f14;color:#e8edf2;margin:0;padding:40px}h1{font-size:42px;color:#34d399}section{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:20px;margin:14px 0;white-space:pre-wrap}img{max-width:100%;border-radius:10px}</style></head><body><h1>${esc(p.title)}</h1>${p.blocks.map(b => b.kind === 'image' ? `<img src="file://${b.content}"/>` : `<section>${esc(b.content)}</section>`).join('')}</body></html>`
      }
      }
      const htmlPath = join(p.dir, `${safe}.html`)
      writeFileSync(htmlPath, html)
      if (p.format === 'html') return htmlPath
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
      try {
        await win.loadFile(htmlPath)
        const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
        const pdfPath = join(p.dir, `${safe}.pdf`)
        writeFileSync(pdfPath, pdf)
        return pdfPath
      } finally {
        // destroy in a finally: a failed load/print used to leak a hidden
        // renderer process for the rest of the session
        if (!win.isDestroyed()) win.destroy()
      }
    } catch (err) { console.log('[DeskApp] create:export failed:', (err as Error).message); return '' }
  })
  handleIPC('create:payload', () => getCreatePayload())
  handleIPC('create:skills', () => {
    const { CREATE_SKILLS } = require('../shared/create-registry')
    return {
      templates: CREATE_SKILLS.flatMap(s => s.templates).map(t => ({ id: t.id, label: t.label })),
      elements: CREATE_SKILLS.flatMap(s => s.elements || []).map(e => ({ kind: e.kind, label: e.label, snippet: e.snippet })),
    }
  })
  // Workspace state persistence — single source of truth JSON beside the source dir.
  handleIPC('create:save', (_e, p) => {
    try { writeFileSync(join(p.dir, '.deskapp-create.json'), JSON.stringify(p.state)) } catch { /* dir gone */ }
  })
  handleIPC('create:load', (_e, dir: string) => {
    try { return JSON.parse(readFileSync(join(dir, '.deskapp-create.json'), 'utf-8')) } catch { return null }
  })

  // Agent management
  handleIPC('agents:scan', async () => {
    const state = await ctx.agentManager.scanAll()
    return state
  })
  handleIPC('agents:get-state', () => ctx.agentManager.getState())

  // ── Conversational onboarding (bubble-driven first-run flow) ──
  // Aggregates everything the bubble's onboarding state machine needs in one call.
  handleIPC('onboarding:get-state', () => {
    const agentState = ctx.agentManager.getState()
    return {
      needsSetup: needsSetup(),
      existing: readExistingConfig(),
      providers: PROVIDERS,
      dismissedAt: ctx.getSettings().onboardingDismissedAt ?? null,
      externalAgents: agentState.agents
        .filter(a => a.status !== 'not-installed')
        .map(a => ({ id: a.id, name: a.name, status: a.status })),
    }
  })
  handleIPC('onboarding:dismiss', () => {
    const s = { ...ctx.getSettings(), onboardingDismissedAt: Date.now() }
    ctx.saveSettings(s)
    return { ok: true }
  })
  handleIPC('agents:set-active', (_e, id) => {
    ctx.agentManager.setActiveAgent(id as any)
    return true
  })
  handleIPC('agents:get-install-commands', () => {
    const cmds: Record<string, string> = {}
    const detectors = ctx.agentManager.getRegistry().getAllDetectors()
    for (const d of detectors) {
      cmds[d.agentId] = d.getInstallCommand()
    }
    return cmds
  })
  handleIPC('agents:install', async (_e, agentId) => {
    try {
      const detectors = ctx.agentManager.getRegistry().getAllDetectors()
      const detector = detectors.find(d => d.agentId === agentId)
      if (!detector) return { success: false, error: `Unknown agent: ${agentId}` }
      const result = await detector.detect()
      if (result.found) return { success: true }
      const installResult = await detector.install()
      if (installResult.success) {
        await ctx.agentManager.scanAll()
        return { success: true }
      }
      return { success: false, error: installResult.error || `Install failed for ${agentId}` }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Bubble window controls
  onIPC('bubble:resize', (_e, h) => {
    const w = BrowserWindow.fromWebContents(_e.sender)
    if (w && !w.isDestroyed()) {
      const c = w.getBounds()
      w.setBounds({ x: c.x, y: c.y, width: c.width, height: Math.round(Math.max(280, Math.min(800, h))) })
    }
  })
  onIPC('bubble:minimize', (_e) => {
    const w = BrowserWindow.fromWebContents(_e.sender)
    if (w && !w.isDestroyed()) w.minimize()
  })
  onIPC('bubble:maximize', (_e) => {
    const w = BrowserWindow.fromWebContents(_e.sender)
    if (w && !w.isDestroyed()) w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  onIPC('bubble:close', (_e) => {
    const w = BrowserWindow.fromWebContents(_e.sender)
    if (w && !w.isDestroyed()) w.close()
    setTimeout(() => {
      ctx.showPetWindows(ctx.petWindow?.win, ctx.hitWindow?.win)
    }, 100)
  })

  // VFS
  const vfs = getVfs()
  handleIPC('vfs:list', () => vfs.listVfsFiles())
  handleIPC('vfs:workspace', () => vfs.getWorkspaceDir())
  handleIPC('vfs:import', (_e, path) => vfs.vfsImport(path))
  // D3 #48: pdf → txt extraction (pypdf in the engine venv, sha256 LRU cache)
  handleIPC('pdf:extract', async (_e, path) => require('./pdf-extract').extractPdfText(String(path || '')))
  // D4 #46: mentions buffer (fed by future connectors / tests)
  handleIPC('mentions:list', (_e, channel?: string) => require('./mentions').listMentions(channel || undefined))
  handleIPC('mentions:ingest', (_e, m: any) => require('./mentions').ingestMention(m))
  // #23: settings asks the bubble to re-open the LLM provider card
  handleIPC('onboarding:open', () => {
    // broadcast — only BubbleApp subscribes
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('onboarding:show') } catch { /* gone */ }
    }
    return true
  })
  handleIPC('vfs:read', (_e, name) => vfs.vfsRead(name))
  handleIPC('vfs:open', (_e, name) => { getFileExplorer().openVfsFile(name) })
  handleIPC('vfs:reveal', (_e, name) => { shell.showItemInFolder(join(vfs.getWorkspaceDir(), basename(name))) })
  // #31: roots
  handleIPC('vfs:list-roots', () => vfs.listRoots())
  handleIPC('vfs:add-root', (_e, dir: string) => vfs.addRoot(String(dir || '')))
  handleIPC('vfs:remove-root', (_e, dir: string) => vfs.removeRoot(String(dir || '')))
  handleIPC('file-explorer:open', () => { getFileExplorer().openFileExplorer(join(__dirname, '../preload/index.js')) })

  // Sessions
  const sessionStore = getSessionStore()
  handleIPC('session:save', (_e, sid, data) => { sessionStore.saveSession(sid, data) })

  // Environment self-check — see src/main/doctor.ts (docs/ax/README.md P0 #5)
  handleIPC('doctor:run', () => require('./doctor').runDoctor())
  handleIPC('session:load', (_e, sid) => sessionStore.loadSession(sid))

  // Agent stats
  const stats = getAgentStats()
  handleIPC('agent-stats', () => stats.getAgentStats())
  handleIPC('agent-stats:track-tool', (_e, n, ok, dur) => { stats.trackToolCall(n, ok, dur) })
  handleIPC('agent-stats:track-error', (_e, p, s) => { stats.trackError(p, s) })
  handleIPC('agent-stats:track-attempt', (_e, t, a, ap, ok) => { stats.trackAttempt(t, a, ap, ok) })
  handleIPC('agent-stats:track-context', (_e, id, desc) => { stats.trackContextBullet(id, desc) })
  handleIPC('agent-stats:track-decision', (_e, t, p, a, v) => { stats.trackDecision(t, p, a, v) })
  handleIPC('agent-stats:score', (_e, n, s, m) => { stats.updateCapabilityScore(n, s, m) })

  // Session list
  // #14: SQLite store is authoritative (pinned/archived/title live there)
  handleIPC('sessions:list', () => {
    try { return sessionStore.listSessions() } catch { return [] }
  })
  handleIPC('sessions:delete', (_e, sid) => sessionStore.deleteSession(sid))
  // #14 row actions
  handleIPC('sessions:rename', (_e, sid, title) => { sessionStore.setSessionTitle(sid, title); return true })
  handleIPC('sessions:pin', (_e, sid, pinned) => { sessionStore.setSessionFlag(sid, 'pinned', !!pinned); return true })
  handleIPC('sessions:archive', (_e, sid, archived) => { sessionStore.setSessionFlag(sid, 'archived', !!archived); return true })
  handleIPC('sessions:restore', (_e, sid) => {
    return sessionStore.loadSession(sid)
  })

  // #20 cron jobs
  const cron = require('./cron')
  handleIPC('cron:list', () => cron.listJobs())
  handleIPC('cron:create', (_e, job) => cron.createJob(job))
  handleIPC('cron:update', (_e, id, p) => { cron.updateJob(id, p) })
  handleIPC('cron:delete', (_e, id) => { cron.deleteJob(id) })

  // Scheduler: 日程/会议/项目/任务（独立窗口, 内部库, 预留 CalDAV/EventKit 同步）
  const scheduler = require('./scheduler')
  handleIPC('scheduler:list-events', (_e, date?: string) => scheduler.listEvents(date))
  handleIPC('scheduler:create-event', (_e, ev) => scheduler.createEvent(ev))
  handleIPC('scheduler:update-event', (_e, id, patch) => { scheduler.updateEvent(id, patch) })
  handleIPC('scheduler:delete-event', (_e, id) => { scheduler.deleteEvent(id) })
  handleIPC('scheduler:list-projects', () => scheduler.listProjects())
  handleIPC('scheduler:create-project', (_e, p) => scheduler.createProject(p))
  handleIPC('scheduler:update-project', (_e, id, patch) => { scheduler.updateProject(id, patch) })
  handleIPC('scheduler:delete-project', (_e, id) => { scheduler.deleteProject(id) })
  handleIPC('scheduler:list-tasks', (_e, projectId?: string) => scheduler.listTasks(projectId))
  handleIPC('scheduler:create-task', (_e, task) => scheduler.createTask(task))
  handleIPC('scheduler:update-task', (_e, id, patch) => { scheduler.updateTask(id, patch) })
  handleIPC('scheduler:delete-task', (_e, id) => { scheduler.deleteTask(id) })
  handleIPC('scheduler:today', () => scheduler.todaySummary())
  handleIPC('scheduler:sync', (_e, dir) => scheduler.syncToCalendars(dir))
  handleIPC('scheduler:briefing', (_e, enabled) => scheduler.ensureDailyBriefing(enabled))
  handleIPC('scheduler:briefing-state', () => scheduler.briefingEnabled())
  const screen = require('./screen-control')
  handleIPC('screen:perm', () => screen.permStatus())
  handleIPC('screen:open-prefs', (_e, kind) => screen.openSystemPrefs(kind))
  handleIPC('screen:list-apps', () => screen.listApps())
  handleIPC('screen:open', (_e, name) => screen.openApp(name))
  handleIPC('screen:activate', (_e, name) => screen.activateApp(name))
  handleIPC('screen:quit', (_e, name) => screen.quitApp(name))

  // ── Generative UI ──
  const genui = require('./gen-ui')

  onIPC('genui:open', () => genui.openGenUiWindows())
  onIPC('genui:open-card', (_e, specId?: string) => {
    console.log('[genui:open-card]', specId)
    genui.openCardFlow(specId)
  })
  // Card window traffic-light buttons (sender = the card window)
  const cardWin = require('./card-window')
  onIPC('card:minimize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) cardWin.minimizeCard(w) })
  onIPC('card:stop-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) cardWin.stopAndCloseCard(w) })
  onIPC('card:resize', (e, w2, h2) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) w.setBounds({ ...w.getBounds(), width: Math.round(w2), height: Math.round(h2) }) })
  // Standalone detail popup (draggable across the screen)
  const detailWin = require('./detail-window')
  onIPC('detail:open', (_e, title: string, content: string) => {
    const preload = join(__dirname, '../preload/index.js')
    detailWin.createDetailWindow(preload, { title: String(title || ''), content: String(content || '') })
  })
  handleIPC('detail:get', () => detailWin.getDetailPayload())
  // Dock window traffic lights (minimize → macOS Dock, close, maximize → workspace)
  const dockWin = require('./dock-window')
  onIPC('dock:minimize', () => { const d = dockWin.getDockWindow(); if (d && !d.isDestroyed()) d.minimize() })
  onIPC('dock:close', () => { const d = dockWin.getDockWindow(); if (d && !d.isDestroyed()) d.close() })
  onIPC('dock:maximize', () => require('./gen-ui').openGenUiWindows())
  // Create work window controls (its own window type)
  onIPC('create:win-min', () => { const w = require('./create-window').getCreateWorkWindow(); if (w) w.minimize() })
  onIPC('create:win-max', () => { const w = require('./create-window').getCreateWorkWindow(); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()) })
  onIPC('create:win-close', () => { const w = require('./create-window').getCreateWorkWindow(); if (w) w.close() })
  // Sub-window edits → live-refresh the main work window (no focus round-trip)
  onIPC('create:state-changed', () => {
    const w = require('./create-window').getCreateWorkWindow()
    if (w) w.webContents.send('create:refresh')
  })
  onIPC('genui:name-draft', (e, title: string) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && title) cardWin.nameDraftCard(w, title)
  })
  onIPC('genui:focus-spec', (_e, id: string) => {
    try {
      // 卡片窗口已开 → 聚焦；未开 → 打开该 spec 的卡片流（dock 单例复用）
      const cw = require('./card-window')
      if (cw.focusCard(id)) return
      require('./gen-ui').openCardFlow(id || undefined)
    } catch { /* window not open */ }
  })

  // Broadcast helper for genui push events
  const broadcastGenUI = (channel: string, ...args: any[]) => {
    for (const w of BrowserWindow.getAllWindows()) {
      safeSend(w.webContents, channel, ...args)
    }
  }

  handleIPC('genui:list-specs', () => genui.listSpecs())
  handleIPC('genui:pulled-out', () => require('./card-window').pulledOutSpecs())
  handleIPC('genui:open-path', (_e, p: string) => {
    // 办公创作: 打开生成的成品 (HTML PPT/画册/文档/动画) — 系统默认应用
    if (typeof p === 'string' && p.trim()) {
      // URL scheme → external browser (renderer link clicks); else open as file
      if (/^https?:\/\//i.test(p.trim())) shell.openExternal(p.trim()).catch?.(() => {})
      else shell.openPath(p.trim()).catch?.(() => {})
    }
  })
  handleIPC('genui:list-statuses', () => genui.listStatuses())
  handleIPC('genui:run-spec', (_e, id) => {
    console.log('[genui:run-spec]', id)
    const spec = genui.listSpecs().find((s: any) => s.id === id)
    if (!spec) return { ok: false, error: 'spec not found' }
    const result = genui.handleRun(spec)
    if ('error' in result) return { ok: false, error: result.error }
    genui.setStatus(id, { status: 'running', jobId: result.jobId })
    broadcastGenUI('genui:status-changed', genui.getStatus(id))
    return { ok: true, jobId: result.jobId }
  })
  handleIPC('genui:stop-spec', (_e, id) => genui.handleStop(id))
  handleIPC('genui:save-spec', (_e, spec) => genui.handleSave(spec))
  handleIPC('genui:remove-spec', (_e, id) => {
    genui.removeSpec(id)  // broadcasts spec-removed itself
    return { ok: true }
  })
  handleIPC('genui:modify-spec', async (_e, id, instruction) => {
    const spec = genui.listSpecs().find((s: any) => s.id === id)
    const result = await genui.generateSpec(instruction, spec)
    if ('error' in result) return { ok: false, error: result.error }
    broadcastGenUI('genui:spec-changed', result)
    return { ok: true, spec: result }
  })
  handleIPC('genui:get-webhook', () => genui.getWebhookUrl())
  handleIPC('genui:set-webhook', (_e, url: string) => { genui.setWebhookUrl(url) })

  // ── Skill Hub ──
  const skillStore = getSkillsStore()
  const skillXlator = getSkillsTranslator()

  handleIPC('skills:list', () => {
    const result = skillStore.listSkills()
    console.log('[DeskApp] skills:list →', result.length, 'skills')
    return result
  })
  handleIPC('skills:get', (_e, name) => skillStore.getSkill(name))
  handleIPC('skills:install', (_e, skill) => { skillStore.installSkill(skill as any); return true })
  handleIPC('skills:remove', (_e, name) => skillStore.removeSkill(name))
  handleIPC('skills:set-active', (_e, name, active, agent) => {
    skillStore.setSkillActive(name, active, agent as any)
    return true
  })
  handleIPC('skills:sync-hermes', () => skillStore.syncAllToHermes())
  handleIPC('skills:sync-claude', () => skillXlator.syncToClaudeCode())
  handleIPC('skills:sync-cursor', () => skillXlator.syncToCursor())
  handleIPC('skills:sync-codex', () => skillXlator.syncToCodex())
  handleIPC('skills:sync-openclaw', () => skillXlator.syncToOpenClaw())
  // skills:sync-all — orphan handler, no preload endpoint; kept as raw ipcMain for compatibility
  ipcMain.handle('skills:sync-all', () => skillXlator.syncAllAgents())
  handleIPC('skills:count', () => skillStore.listSkills().length)
  handleIPC('skills:categories', () => {
    try {
      const p = join(__dirname, '../../resources/categories.json')
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
    } catch { }
    return { version: 1, categories: [] }
  })
  handleIPC('skills:discover', () => skillStore.listSkills())
  handleIPC('skills:community-registry', () => {
    try {
      const p = join(__dirname, '../../resources/community-registry.json')
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
    } catch { }
    return { version: 1, skills: [] }
  })
  handleIPC('skills:refresh-community', async () => {
    try {
      const url = 'https://raw.githubusercontent.com/deskapp-hub/skills/main/registry.json'
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json()
        const local = skillStore.listSkills()
        const localMap = new Map(local.map((s: any) => [s.name, s] as [string, any]))
        const community = (data.skills || []).map((s: any) => ({
          ...s,
          installed: localMap.has(s.name),
          hasUpdate: localMap.has(s.name) && (localMap.get(s.name) as any)?.version !== s.version,
          localVersion: (localMap.get(s.name) as any)?.version,
        }))
        return { ok: true, skills: community, source: 'github' as const }
      }
    } catch { }
    try {
      const p = join(__dirname, '../../resources/community-registry.json')
      if (existsSync(p)) {
        const data = JSON.parse(readFileSync(p, 'utf-8'))
        const local = skillStore.listSkills()
        const localMap = new Map(local.map((s: any) => [s.name, s] as [string, any]))
        const community = (data.skills || []).map((s: any) => ({
          ...s,
          installed: localMap.has(s.name),
          hasUpdate: false,
          localVersion: (localMap.get(s.name) as any)?.version,
        }))
        return { ok: true, skills: community, source: 'local' as const }
      }
    } catch { }
    return { ok: false, skills: [], source: 'none' as const }
  })
  handleIPC('skills:search-github', async () => {
    try {
      const resp = await fetch('https://api.github.com/search/repositories?q=SKILL.md+agent&per_page=10&sort=stars')
      const data = await resp.json() as any
      if (data.items) return { ok: true, skills: data.items.map((i: any) => ({ name: i.name, stars: i.stargazers_count, description: i.description?.substring(0, 100), repo: i.full_name })) }
    } catch (e: any) { return { ok: false, error: e.message } }
    return { ok: false, error: 'No results' }
  })
  handleIPC('skills:install-remote', async (_e, rawUrl, name, category) => {
    try {
      // SSRF guard: only HTTPS from known code-hosting domains.
      // Without this the renderer could make the main process fetch arbitrary
      // URLs (file://, intranet, metadata endpoints) and install the response
      // as a skill — which lands in every agent's system prompt.
      let parsed: URL
      try { parsed = new URL(rawUrl) } catch { return { ok: false, error: 'Invalid URL' } }
      const ALLOWED_HOSTS = ['raw.githubusercontent.com', 'github.com', 'gist.githubusercontent.com', 'gitee.com']
      const hostOk = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))
      if (parsed.protocol !== 'https:' || !hostOk) {
        return { ok: false, error: 'URL not allowed: only HTTPS links from GitHub/Gitee are supported' }
      }
      const resp = await fetch(rawUrl, { redirect: 'follow' })
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
      const MAX_BYTES = 512 * 1024
      const declared = Number(resp.headers.get('content-length') || 0)
      if (declared > MAX_BYTES) return { ok: false, error: 'Skill file too large (>512KB)' }
      const content = await resp.text()
      if (content.length > MAX_BYTES) return { ok: false, error: 'Skill file too large (>512KB)' }
      const skill = skillStore.parseCanonical(content) || {
        name, version: '0.1.0', author: 'community', category, tags: [], trigger: '',
        description: 'Community skill from GitHub', instructions: content, adapters: {},
        active: true, activeFor: ['hermes'], source: 'hub',
      }
      skillStore.installSkill(skill as any)
      skillStore.syncToHermes(name)
      return { ok: true, name }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Permission gate (Phase 6) ──
  handleIPC('agents:permission-response', (event, id: string, outcome: 'once' | 'session' | 'always' | 'deny' | 'turn', command?: string) => {
    const key = String(event.sender.id)
    // #12: 'turn' — remember the command for this turn, answer 'once' to the bridge
    if (outcome === 'turn') {
      const at = activeTurns.get(event.sender.id)
      if (at && command) {
        const tg = turnGrants.get(event.sender.id)
        if (tg && tg.turnId === at.turnId) tg.commands.add(command)
        else turnGrants.set(event.sender.id, { turnId: at.turnId, commands: new Set([command]) })
      }
      return bridgeManager.respondPermission(key, id, 'once')
    }
    const ok = bridgeManager.respondPermission(key, id, outcome)
    return ok
  })

  // #28: MCP server status — read-only view of hermes config (no write path;
  // server management stays in ~/.hermes/config.yaml per hermes docs)
  handleIPC('mcp:status', () => {
    const { homedir } = require('os')
    const configPath = join(homedir(), '.hermes', 'config.yaml')
    const servers: { name: string; transport: string }[] = []
    try {
      const text = readFileSync(configPath, 'utf-8')
      const lines = text.split('\n')
      let inMcp = false, mcpIndent = -1
      for (const line of lines) {
        const indent = line.search(/\S/)
        if (/^\s*mcp_servers:/.test(line)) { inMcp = true; mcpIndent = indent; continue }
        if (inMcp) {
          if (line.trim() === '') continue
          if (indent <= mcpIndent) { inMcp = false; continue }
          const m = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*$/)
          if (m && indent === mcpIndent + 2) servers.push({ name: m[1], transport: 'stdio/http' })
        }
      }
    } catch { /* config missing → empty list */ }
    return { servers, configPath }
  })

  // #26: persona manifests
  {
    const personas = require('./personas')
    handleIPC('persona:list', () => personas.listPersonas())
    handleIPC('persona:save', (_e, p) => personas.savePersona(p))
    handleIPC('persona:delete', (_e, id: string) => personas.deletePersona(id))
    handleIPC('persona:active', (_e, id: string | null) => personas.setActivePersona(id ?? null))
  }

  // #29: secrets — names only cross IPC; values never leave main
  {
    const secrets = require('./secrets')
    handleIPC('secrets:list', () => secrets.listSecrets())
    handleIPC('secrets:set', (_e, name: string, value: string) => secrets.setSecret(name, value))
    handleIPC('secrets:delete', (_e, name: string) => secrets.deleteSecret(name))
  }

  // #30: workspace trust list
  {
    const trust = require('./trust')
    handleIPC('trust:list', () => trust.listTrusted())
    handleIPC('trust:add', (_e, dir: string) => trust.trustDir(dir))
    handleIPC('trust:remove', (_e, dir: string) => trust.untrustDir(dir))
    handleIPC('trust:status', () => {
      const dir = vfs.getWorkspaceDir()
      return { dir, trusted: trust.isTrusted(dir) }
    })
  }

  // #32: audit log — newest JSONL lines first (desktop-agent writes userData/audit/YYYY-MM-DD.jsonl)
  handleIPC('audit:recent', (_e, limit?: number) => {
    try {
      const dir = join(app.getPath('userData'), 'audit')
      if (!existsSync(dir)) return []
      const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse()
      const out: any[] = []
      const cap = Math.min(limit || 100, 500)
      for (const f of files) {
        if (out.length >= cap) break
        const lines = readFileSync(join(dir, f), 'utf-8').trim().split('\n').filter(Boolean).reverse()
        for (const ln of lines) {
          if (out.length >= cap) break
          try { out.push(JSON.parse(ln)) } catch { /* skip */ }
        }
      }
      return out
    } catch { return [] }
  })

  // #45: dead-letter ring — newest first, 200-cap FIFO
  handleIPC('deadletter:list', () => require('./deadletter').listDeadLetters())

  // #44: update pipeline
  {
    const updater = require('./updater')
    handleIPC('update:check', () => updater.checkNow())
    handleIPC('update:download', () => updater.downloadUpdate())
    handleIPC('update:install', () => updater.installUpdate())
    handleIPC('update:get', () => updater.getUpdateStatus())
    handleIPC('update:dismiss', (_e, version: string) => {
      const s = { ...ctx.getSettings(), dismissedUpdateVersion: String(version || '') }
      ctx.saveSettings(s)
      return true
    })
  }

  // #33: user's answer for an ask_user question card
  handleIPC('agents:question-response', (event, id: string, answer: string) => {
    return bridgeManager.respondQuestion(String(event.sender.id), id, String(answer || ''))
  })

  // #35: user's decision on a proposed task-tree plan
  handleIPC('agents:plan-confirm', (event, ok: boolean) => {
    const resolve = pendingPlanConfirms.get(event.sender.id)
    if (!resolve) return false
    pendingPlanConfirms.delete(event.sender.id)
    resolve(!!ok)
    return true
  })

  // ── Session grants (P0-4A) ──
  {
    const grants = require('./agents/grants')
    handleIPC('grants:list', () => grants.getAllGrants())
    handleIPC('grants:remove', (_e, kind: string, tool: string, command?: string, path?: string) =>
      grants.removeGrant(kind, tool, command, path))
    handleIPC('grants:clear', () => { grants.clearAllGrants() })
    handleIPC('grants:check-input', (_e, categories: string[]) => grants.checkInputGrant(categories))
    handleIPC('grants:add-input', (_e, categories: string[]) => { grants.addInputGrant(categories); return true })
    // Phase 6 Step 3: mirror an approval-card 'session'/'always' decision into
    // the session grants store (visibility in SecurityTab)
    handleIPC('grants:add', (_e, kind: string, tool: string, command?: string, path?: string) => {
      grants.addGrant(kind, tool, command, path)
      return true
    })
  }

  // ── Inbox (P0-5) ──
  {
    const inbox = require('./inbox')
    handleIPC('inbox:list', () => inbox.listOpen())
    handleIPC('inbox:count', () => inbox.openCount())
    handleIPC('inbox:resolve', (_e, id: string, by?: string) =>
      inbox.resolveItem(id, (by as 'user-click' | 'user-dismiss' | 'auto-timeout') || 'user-click'))
    // Broadcast open-count changes to every window (pet badge, bubble panel)
    inbox.onInboxChange((count: number) => {
      for (const w of BrowserWindow.getAllWindows()) {
        safeSend(w.webContents, 'inbox:changed', count)
      }
    })
  }

  // ── Habit Engine ──
  const habitService = require('./habit/habit-service')

  // Queries
  handleIPC('habit:state', () => habitService.getServiceState())
  handleIPC('habit:events', (_e, limit?: number) => habitService.queryRecentEvents(limit ?? 100))
  handleIPC('habit:habits', () => habitService.queryHabits())
  handleIPC('habit:segments', (_e, date: string) => habitService.querySegments(date))
  handleIPC('habit:pause', () => { habitService.setPrivacyPause(true) })
  handleIPC('habit:resume', () => { habitService.setPrivacyPause(false) })

  // Actions
  handleIPC('habit:briefing', () => habitService.getMorningBriefing())
  // A6 修复：第一个参数是 userMessage（用于关键词匹配），第二个才是 currentApp
  handleIPC('habit:context-text', (_e, userMessage?: string, currentApp?: string) =>
    habitService.getContextText(userMessage, currentApp))
  handleIPC('habit:deviations', (_e, currentApp?: string) => habitService.getDeviations(currentApp))
  handleIPC('habit:confirm', (_e, id: number) => { habitService.confirmHabit(id) })
  handleIPC('habit:dismiss', (_e, id: number) => { habitService.dismissHabit(id) })
  handleIPC('habit:activate', (_e, id: number) => { habitService.activateHabit(id) })
  handleIPC('habit:extract', () => habitService.runExtraction())
  handleIPC('habit:automation', () => habitService.runAutomation())
  handleIPC('habit:run-pipeline', () => habitService.runDailyPipeline())
  handleIPC('habit:score', () => habitService.getScore())
  handleIPC('habit:execute', (_e, id: number) => habitService.executeHabit(id))
  handleIPC('habit:weekly-report', () => habitService.getLatestWeeklyReport())
  handleIPC('habit:score-insight', () => habitService.getScoreInsight())
  handleIPC('habit:run-weekly', () => habitService.runWeeklyPipeline())

  // Privacy & data
  const habitStore = require('./habit/store')
  handleIPC('habit:enabled', () => habitService.isHabitEnabled())
  handleIPC('habit:set-enabled', (_e, enabled: boolean) => { habitService.setHabitEnabled(enabled) })
  handleIPC('habit:ai-summary-enabled', () => habitService.isAISummaryEnabled())
  handleIPC('habit:set-ai-summary', (_e, enabled: boolean) => { habitService.setAISummaryEnabled(enabled) })
  handleIPC('habit:export', () => habitStore.exportAllData())
  handleIPC('habit:delete-all', () => habitStore.deleteAllData())

  // ── Provider info & capabilities (P1-B3 #23) ──
  handleIPC('agents:provider-info', () => ({
    provider: WORKER_PROVIDER,
    workerModel: WORKER_MODEL,
    plannerModel: PLANNER_MODEL,
    capabilities: {
      worker: getCapabilities(WORKER_MODEL),
      planner: getCapabilities(PLANNER_MODEL),
    },
  }))

  handleIPC('agents:verify-provider', async () => {
    const t0 = Date.now()
    // throwaway bridge: without the dispose this left a 135MB python process
    // behind on every "verify provider" click
    const key = 'verify-' + Date.now()
    try {
      await bridgeManager.ping(key)
      return { ok: true, latencyMs: Date.now() - t0, model: WORKER_MODEL }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      bridgeManager.dispose(key)
    }
  })

  // ── Memory (P1-B3 #16) ──
  {
    const memory = require('./memory/store')
    handleIPC('memory:list', () => memory.listAll())
    handleIPC('memory:remember', (_e, scope: string, value: string, key?: string) =>
      memory.remember(scope, value, { key, workspace: scope === 'global' ? '' : vfs.getWorkspaceDir() }))
    handleIPC('memory:update', (_e, id: number, value: string) => memory.updateMemory(id, value))
    handleIPC('memory:forget', (_e, id: number) => memory.forget(id))
    handleIPC('memory:move', (_e, id: number, scope: string) => memory.moveMemory(id, scope))
  }

  // ── Voice ──
  {
    const { voiceBridge } = require('./voice-bridge')

    handleIPC('voice:start', async () => {
      try {
        await voiceBridge.start()
        // Wire up callbacks for push events
        voiceBridge.setCallbacks({
          onAsrResult: (text: string) => {
            for (const w of BrowserWindow.getAllWindows()) {
              safeSend(w.webContents, 'voice:asr-result', text)
            }
          },
          onTtsDone: (id: string, path: string) => {
            for (const w of BrowserWindow.getAllWindows()) {
              safeSend(w.webContents, 'voice:tts-ready', id, path)
            }
          },
          onTtsError: (id: string, message: string) => {
            for (const w of BrowserWindow.getAllWindows()) {
              safeSend(w.webContents, 'voice:tts-error', id, message)
            }
          },
          onError: (message: string) => {
            console.error('[Voice]', message)
          },
        })
        return true
      } catch (e) {
        console.error('[Voice] start failed:', (e as Error).message)
        return false
      }
    })

    handleIPC('voice:asr', async (_e, audioBase64: string) => {
      try {
        return await voiceBridge.requestAsr(String(audioBase64 || ''))
      } catch {
        return ''
      }
    })

    handleIPC('voice:tts', async (_e, text: string, id: string) => {
      if (!voiceBridge.isAlive()) {
        try { await voiceBridge.start() } catch { return false }
      }
      try {
        await voiceBridge.sendTts(text, id)
        return true
      } catch {
        return false
      }
    })

    handleIPC('voice:stop', () => {
      voiceBridge.stop()
    })

    handleIPC('voice:interrupt', () => {
      voiceBridge.interrupt()
    })
  }
}
