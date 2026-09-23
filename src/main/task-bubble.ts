import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'

const BUBBLE_GAP = 8
const BUBBLE_WIDTH = 570
const BUBBLE_HEIGHT = 480

const bubbles = new Set<BrowserWindow>()

export function getBubbleWindows(): BrowserWindow[] {
  return [...bubbles].filter(w => !w.isDestroyed())
}
let bubbleIndex = 0
const isMac = process.platform === 'darwin'

export function createBubbleWindow(preloadPath: string): BrowserWindow {
  const isLinux = process.platform === 'linux'

  const win = new BrowserWindow({
    width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT,
    show: false,
    frame: false,
    // macOS IME: the candidate window cannot render over a TRANSPARENT window
    // (Chinese/Japanese input breaks regardless of focus tricks). Opaque +
    // backgroundColor matching the panel keeps the rounded-glass look.
    transparent: false,
    backgroundColor: '#1c1c1e',
    hasShadow: true, resizable: true,
    skipTaskbar: false, alwaysOnTop: false,
    focusable: true,
    ...(isLinux ? { type: 'splash' as const } : {}),
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  })

  if (isMac) win.setWindowButtonVisibility(false)
  if (isMac) {
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch {}
  }
  win.setMenuBarVisibility(false)

  const bubblePath = join(__dirname, '../renderer/index.html')
  // Renderer crash (e.g. GPU kill) must not leave a dead blank window —
  // reload so the bubble comes back instead of vanishing mid-conversation.
  attachCrashRecovery(win, 'bubble')
  win.loadFile(bubblePath, { query: { page: 'bubble' } })

  win.on('closed', () => bubbles.delete(win))
  bubbles.add(win)
  bubbleIndex++
  return win
}

export function createNewBubble(preloadPath: string, petBounds: Electron.Rectangle): BrowserWindow {
  const win = createBubbleWindow(preloadPath)
  positionBubbleNear(win, petBounds)
  win.show()
  win.focus()
  // On macOS, opaque frameless windows sometimes need an explicit
  // webContents.focus() for IME (Chinese/Japanese/Korean) candidate windows to
  // route keyboard events correctly.
  // opaque 窗口无需 re-assert focus（原 workaround 针对 transparent 窗口）。
  // webContents.focus() 在 focus 事件时序下会打断 IME 组合会话（中文输入偶发失效）。
  if (isMac) {
    try { win.webContents.focus() } catch { /* closing */ }
  }
  return win
}

export function positionBubbleNear(win: BrowserWindow, petBounds: Electron.Rectangle): void {
  const displays = screen.getAllDisplays()
  const wa = getNearestWorkArea(petBounds, displays)

  let bx = petBounds.x + petBounds.width + BUBBLE_GAP
  let by = petBounds.y + (petBounds.height - BUBBLE_HEIGHT) / 2
  const offset = bubbles.size * 30
  bx += offset; by += offset

  if (bx + BUBBLE_WIDTH > wa.x + wa.width) bx = petBounds.x - BUBBLE_WIDTH - BUBBLE_GAP
  if (by < wa.y) by = wa.y + BUBBLE_GAP
  if (by + BUBBLE_HEIGHT > wa.y + wa.height) by = wa.y + wa.height - BUBBLE_HEIGHT - BUBBLE_GAP
  if (bx < wa.x) bx = wa.x + BUBBLE_GAP

  win.setBounds({ x: Math.round(bx), y: Math.round(by), width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT })
}

function getNearestWorkArea(bounds: Electron.Rectangle, displays: Electron.Display[]): Electron.Rectangle {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let best = displays[0]; let bestDist = Infinity
  for (const d of displays) {
    const dist = Math.hypot(cx - (d.bounds.x + d.bounds.width / 2), cy - (d.bounds.y + d.bounds.height / 2))
    if (dist < bestDist) { bestDist = dist; best = d }
  }
  return best.workArea
}
