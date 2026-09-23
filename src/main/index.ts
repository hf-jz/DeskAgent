import { app, screen, ipcMain, globalShortcut, crashReporter, dialog } from 'electron'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

// Prevent EPIPE crashes when stdout/stderr are closed (e.g. restart.sh &)
process.stdout.on('error', (err: any) => { if (err.code === 'EPIPE') {} })
process.stderr.on('error', (err: any) => { if (err.code === 'EPIPE') {} })

// Global crash guards — a resident desktop app must never die silently.
// crashpad dumps land in userData/Crashes for post-mortem diagnosis.
crashReporter.start({ uploadToServer: false, compress: true })

// Renderer hardening — ONE place for every window (webSecurity:false app-wide):
// block in-window navigation (file:// links would run local files with the
// preload in scope) and deny window.open. External links are handled by the
// renderer via openExternal (system browser) instead.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev) => ev.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})
process.on('uncaughtException', (err) => {
  try { console.error('[DeskApp] uncaughtException:', err) } catch { /* EPIPE safe */ }
})
process.on('unhandledRejection', (reason) => {
  try { console.error('[DeskApp] unhandledRejection:', reason) } catch { /* EPIPE safe */ }
})

import { createPetWindow, PetWindow, PET_WINDOW_WIDTH, PET_BUBBLE_SPACE, walkPetWindow } from './pet-window'
import { createHitWindow, HitWindow, showPetWindows, hidePetWindows } from './hit-window'
import { createDragHandler, DragHandler } from './drag-handler'
import { AgentManager } from './agents/manager'
import type { AbortHandle } from './agents/executor'
import { openSettingsWindow } from './settings-window'
import { openPetCustomizerWindow, closePetCustomizerWindow } from './custom-pet'
import { closeImg2ThreeJsWindow } from './img2threejs'
import { loadSettings, saveSettings, getSizePixels, PetSettings } from './settings-store'
import { initVfs, readWorkspaceProfile, ensureWorkspaceScaffold } from './vfs'
import { initSessionStore } from './session-store'
import { initAgentStats } from './agent-stats'
import { createNewBubble } from './task-bubble'
import { openFileExplorer } from './file-explorer'
import { bridgeManager } from './agents/desktop-agent'
import { hermesGatewayExecutor } from './agents/detect-hermes'
import { registerSetupHandlers } from './setup-wizard'
import { registerAllHandlers, IpcContext } from './ipc-handlers'
import { startMemGuard, stopMemGuard } from './mem-guard'
import { handleIPC, safeSend } from '../shared/ipc-main'
// tray.ts is require()-loaded to avoid Electron API at module scope
const { createTray: makeTray } = require('./tray')

import { installBuiltinSkills } from './builtin-skills'
import { initEdgeAutoHide, checkEdgeSnap, toggleEdgeHide, showFromEdge, getEdgeState, clearEdgeTimers } from './edge-auto-hide'

// B11: habit-service 走惰性 require + 防护——better-sqlite3 原生绑定
// 加载失败时只禁用习惯引擎，绝不让主进程启动崩溃。
function safeInitHabitService(): void {
  try {
    require('./habit/habit-service').initHabitService()
  } catch (e) {
    console.error('[DeskApp] habit engine failed to load (disabled):', (e as Error).message)
  }
}
function safeShutdownHabitService(): void {
  try {
    require('./habit/habit-service').shutdownHabitService()
  } catch { /* already broken at load — nothing to shut down */ }
}

const isMac = process.platform === 'darwin'

let petWindow: PetWindow | null = null
let hitWindow: HitWindow | null = null
let dragHandler: DragHandler | null = null
let tray: Electron.Tray | null = null
let isQuitting = false
let agentManager: AgentManager
const activeAborts = new Map<number, AbortHandle>()
let currentSettings: PetSettings

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) { app.quit() }
else {
  app.on('second-instance', () => {
    showPetWindows(petWindow?.win, hitWindow?.win)
  })

  app.whenReady().then(async () => {
    currentSettings = loadSettings()
    // P0-3: restore persisted tool-risk overrides into the classifier
    try {
      require('./agents/risk').setRiskOverrides(currentSettings.toolRiskOverrides || [])
    } catch { /* risk module unavailable */ }
    // P0-5: durable inbox store (unread approvals, failures, warnings)
    try {
      require('./inbox').initInboxStore(join(app.getPath('userData'), 'inbox.db'))
    } catch { /* inbox unavailable */ }

    // No blocking setup wizard — the pet comes alive first, and the
    // conversational onboarding inside the bubble handles LLM configuration.
    initApp()
  })

  app.on('before-quit', () => {
    isQuitting = true
    clearEdgeTimers()
    stopMouseTracking()
    stopMemGuard()
    closePetCustomizerWindow()
    closeImg2ThreeJsWindow()
    bridgeManager.shutdownAll()
    hermesGatewayExecutor.shutdown()
    safeShutdownHabitService()
  })
  app.on('will-quit', () => {
    const lockFile = join(app.getPath('userData'), 'SingletonLock')
    if (existsSync(lockFile)) try { unlinkSync(lockFile) } catch { /* ok */ }
  })
  app.on('window-all-closed', () => { if (isQuitting) app.quit() })

  // Visibility into system-level process kills. 2026-07-23: GPU process was
  // SIGKILLed (exit_code=9) together with the network service, which took the
  // pet + bubble renderers down. Log it so the next occurrence is diagnosable
  // from the log instead of looking like a spontaneous app crash.
  app.on('child-process-gone', (_e, details) => {
    try {
      console.error(`[DeskApp] child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
    } catch { /* EPIPE safe */ }
  })
}

function initApp(): void {
  agentManager = new AgentManager(() => {})

  // Initialize infrastructure
  initVfs(app.getPath('userData'))
  // Workspace profile (vfs.ts): create the declared local scaffolding once.
  // ponytail: dirs only — repos are cloned by the agent, not silently by us.
  try {
    const profile = readWorkspaceProfile()
    if (profile) {
      const r = ensureWorkspaceScaffold(profile)
      if (!r.skipped) console.log(`[DeskApp] workspace profile "${profile.name ?? 'unnamed'}": scaffolded [${r.created.join(', ') || 'nothing to create'}]`)
    }
  } catch (e) { console.warn('[DeskApp] workspace profile scaffold failed:', String(e)) }
  initSessionStore(app.getPath('userData'))
  try { require('./cron').initCronStore(app.getPath('userData')) } catch { /* cron optional */ }
  try { require('./gen-ui').initGenUi(app.getPath('userData')) } catch { /* genui optional */ }
  try { require('./scheduler').initSchedulerStore(app.getPath('userData')) } catch { /* scheduler optional */ }
  initAgentStats(app.getPath('userData'))

  createWindows()
  initTray()
  registerIPC()
  registerSetupHandlers()
  registerShortcuts()

  // D1 #44: update pipeline (packaged builds only; dev stays idle)
  try {
    require('./updater').initUpdater(() => currentSettings)
  } catch { /* updater unavailable */ }

  // Init edge auto-hide
  initEdgeAutoHide(
    () => petWindow?.win,
    () => hitWindow,
  )

  // Scan agents
  agentManager.scanAll().then((state) => {
    console.log('[DeskApp] Agent scan:', state.agents.map(a => a.id + ':' + a.status).join(', '))
    // First-run agent setup wizard (ponytail: native dialogs, sequential flow;
    // one flag so it only shows once per machine).
    const st = loadSettings()
    if (!st.agentSetupDoneAt) {
      setTimeout(() => runAgentSetupWizard(state.agents), 2500)
    }
  })

/**
 * First-run agent detection wizard — native dialog sequence.
 * 双击打开 → 宠物出现 → 2.5s 后询问是否检测 → 检测/未检测/安装引导。
 * ponytail: uses the boot scan result + native alerts; no window/page code.
 */
function runAgentSetupWizard(agents: { id: string; status: string }[]): void {
  const markDone = () => saveSettings({ ...loadSettings(), agentSetupDoneAt: Date.now() })
  const parent = petWindow?.win
  const ask = (o: Electron.MessageBoxOptions): Promise<number> =>
    dialog.showMessageBox(parent!, o).then(r => r.response).catch(() => -1)

  void ask({
    type: 'question', message: '是否开启 agent 检测程序？',
    detail: '检测系统是否已安装 hermes-agent / openclaw / claude code 等智能体',
    buttons: ['是', '否'], defaultId: 0, cancelId: 1,
  }).then(async (r1) => {
    if (r1 === 0) {
      const installed = agents.filter(a => a.status !== 'not-installed')
      if (installed.length > 0) {
        await ask({
          type: 'info', message: `检测完成：已安装 ${installed.length} 个智能体`,
          detail: installed.map(a => `• ${a.id}`).join('\n'), buttons: ['完成'],
        })
        markDone()
      } else {
        const r2 = await ask({
          type: 'question', message: '未检测到已安装的智能体',
          detail: '是否需要帮助您安装智能体？', buttons: ['帮我安装', '暂不'], defaultId: 0, cancelId: 1,
        })
        if (r2 === 0) {
          await ask({
            type: 'info', message: '安装方式',
            detail: '推荐安装 hermes-agent（DeskApp 的主引擎）：\n\n文档: https://hermes-agent.nousresearch.com/docs\n\n安装完成后重启 deskapp 即可自动识别。',
            buttons: ['完成'],
          })
        }
        markDone()
      }
    } else {
      const r3 = await ask({
        type: 'info', message: '您可在设置中手动检测或者安装 agent 智能体',
        detail: 'Settings → Agents 标签页可查看/安装智能体', buttons: ['打开设置', '知道了'], defaultId: 0, cancelId: 1,
      })
      if (r3 === 0) openSettingsWindow()
      markDone()
    }
  })
}

  // Warm bridge + gateway
  bridgeManager.prewarm()
  hermesGatewayExecutor.prewarm().catch(() => {})
  startMemGuard()

  // Install built-in skills
  installBuiltinSkills()

  // Start habit engine — observe user activity (B11: 惰性加载 + 防护，
  // 且未获知情同意前采集器不会启动)
  safeInitHabitService()

  // L0: only the pet appears at launch — no bubble window pops up. If the
  // LLM key is missing, the pet itself says so via its speech bubble (the
  // renderer checks onboarding:get-state), and configuration happens when
  // the user clicks the pet to open the conversation bubble.
}

function createWindows(): void {
  // D3 #41A: voice input needs mic permission — allow media only for our own
  // windows, deny everything else by default.
  {
    const { session } = require('electron')
    session.defaultSession.setPermissionRequestHandler((_wc: any, permission: string, cb: (ok: boolean) => void) => {
      cb(permission === 'media')
    })
  }

  const size = getSizePixels(currentSettings.size)
  const body = Math.min(size.width, size.height)
  const preloadPath = join(__dirname, '../preload/index.js')

  petWindow = createPetWindow({
    preloadPath,
    loadFilePath: join(__dirname, '../renderer/index.html'),
    width: size.width, height: size.height,
    isMac, isLinux: false, isWin: false,
  })

  const display = screen.getPrimaryDisplay()
  const { x, y } = display.workArea
  petWindow.win.setPosition(
    Math.round(x + (display.workArea.width - PET_WINDOW_WIDTH) / 2),
    Math.round(y + (display.workArea.height - (body + PET_BUBBLE_SPACE)) / 2),
  )

  hitWindow = createHitWindow({
    preloadPath,
    hitHtmlPath: join(__dirname, '../renderer/hit.html'),
    petWindow: petWindow.win,
    bodySize: body,
    isMac, isLinux: false, isWin: false,
  })

  dragHandler = createDragHandler({
    petWindow: petWindow.win,
    hitWindow: hitWindow.win,
    screen,
    onDragEnd: (bounds) => checkEdgeSnap(bounds),
  })

  startMouseTracking()
}

// ── Mouse-follow: pet turns its head toward the cursor ──────────────────
// Poll the global cursor position vs the pet window center; push proximity
// to the pet renderer (CustomPet rotates toward {dx, dy}). Only a coarse
// poll — cheap, no global input hooks needed.
let mousePollTimer: NodeJS.Timeout | null = null

function startMouseTracking(): void {
  stopMouseTracking()
  mousePollTimer = setInterval(() => {
    if (!petWindow?.win || petWindow.win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const b = petWindow.win.getBounds()
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const dx = cursor.x - cx
    const dy = cursor.y - cy
    safeSend(petWindow.win.webContents, 'pet:mouse', {
      near: Math.hypot(dx, dy) < 340,
      dx,
      dy,
    })
  }, 350)
}

function stopMouseTracking(): void {
  if (mousePollTimer) { clearInterval(mousePollTimer); mousePollTimer = null }
}

function doNewTask(): void {
  if (!petWindow?.win) return
  // Auto-show if hidden at edge
  if (getEdgeState() !== 'visible') showFromEdge()

  const win = createNewBubble(join(__dirname, '../preload/index.js'), petWindow.win.getBounds())

  const wcId = win.webContents.id
  win.once('closed', () => {
    activeAborts.get(wcId)?.abort()
    activeAborts.delete(wcId)
    bridgeManager.dispose(String(wcId))
  })

  if (hitWindow?.win && !hitWindow.win.isDestroyed()) {
    hitWindow.win.moveTop()
  }
}

function applyPetSize(size: 'S' | 'M' | 'L'): void {
  if (!petWindow?.win) return
  const px = getSizePixels(size)
  const body = Math.min(px.width, px.height)
  petWindow.win.setSize(PET_WINDOW_WIDTH, body + PET_BUBBLE_SPACE)

  if (hitWindow?.win && !hitWindow.win.isDestroyed()) {
    const b = petWindow.win.getBounds()
    hitWindow.win.setSize(body, body)
    hitWindow.win.setPosition(
      b.x + Math.round((b.width - body) / 2),
      b.y + b.height - body,
    )
  }
}

function registerIPC(): void {
  handleIPC('pet:walk', (_e, dx, durationMs) => {
    if (!petWindow?.win) return 0
    // The idle walk slides the pet window (and its hit window) sideways. While
    // the pet is hidden at an edge that would drag it back on-screen with only a
    // hidden hit window — visible but unclickable. Stay put instead.
    if (getEdgeState() !== 'visible') return 0
    return walkPetWindow(petWindow.win, hitWindow?.win ?? null, dx, durationMs)
  })

  const steeringQueue = new Map<number, string[]>()
  const ctx: IpcContext = {
    petWindow, hitWindow, agentManager,
    getSettings: () => currentSettings,
    saveSettings: (s) => { currentSettings = s; saveSettings(s) },
    applyPetSize,
    openSettingsWindow,
    openPetCustomizer: () => openPetCustomizerWindow(),
    showPetWindows: (pet, hit) => showPetWindows(pet, hit),
    doNewTask,
    edgeToggle: toggleEdgeHide,
    isQuitting: () => isQuitting,
    setQuitting: (v) => { isQuitting = v },
    activeAborts,
    steeringQueue,
    getEdgeState,
    showFromEdge,
  }
  registerAllHandlers(ctx)
}

function registerShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+M', () => doNewTask())
  globalShortcut.register('CommandOrControl+Shift+E', () => openFileExplorer(join(__dirname, '../preload/index.js')))
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    try { require('./scheduler-window').openSchedulerWindow() } catch { /* scheduler window unavailable */ }
  })
  globalShortcut.register('CommandOrControl+Shift+,', () => openSettingsWindow())
  globalShortcut.register('CommandOrControl+Shift+H', () => toggleEdgeHide())
}

function initTray(): void {
  tray = makeTray(
    doNewTask,
    openSettingsWindow,
    () => petWindow?.win?.isVisible() ?? false,
    () => showPetWindows(petWindow?.win, hitWindow?.win),
    () => hidePetWindows(petWindow?.win, hitWindow?.win),
  )
}
