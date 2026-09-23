// ── Workspace window: spec card list + detail panel ──
// Minimize animates the window shrinking into the dock bar (right edge);
// dock icon click animates it back out. No recompile, pure bounds animation.
import { BrowserWindow, screen } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'
import { DOCK_W as DOCK_WINDOW_W } from './dock-window'

const isMac = process.platform === 'darwin'
const W = 1000, H = 680
const DOCK_W = 40
const ANIM_MS = 180, ANIM_STEPS = 8
let _win: BrowserWindow | null = null
let _savedBounds: Rectangle | null = null
let _animating = false

/** Dock strip anchor: centered in the dock panel, vertically centered. */
export function dockTarget(): Rectangle {
  const d = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(d.x + d.width - DOCK_WINDOW_W / 2 - DOCK_W / 2),
    y: Math.round(d.y + d.height / 2 - 20),
    width: DOCK_W, height: 40,
  }
}

export function animateBounds(win: BrowserWindow, to: Rectangle, done: () => void): void {
  const from = win.getBounds()
  let step = 0
  const timer = setInterval(() => {
    step++
    const t = step / ANIM_STEPS
    const e = 1 - Math.pow(1 - t, 2)  // ease-out
    if (win.isDestroyed()) { clearInterval(timer); return }
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
      width: Math.round(from.width + (to.width - from.width) * e),
      height: Math.round(from.height + (to.height - from.height) * e),
    })
    if (step >= ANIM_STEPS) { clearInterval(timer); done() }
  }, ANIM_MS / ANIM_STEPS)
}

/** Shrink the workspace window into the dock, then hide it. */
export function minimizeToDock(win: BrowserWindow): void {
  if (_animating || win.isDestroyed()) return
  _animating = true
  _savedBounds = win.getBounds()
  win.restore()  // cancel the native minimize; we animate instead
  animateBounds(win, dockTarget(), () => {
    if (!win.isDestroyed()) {
      win.hide()
      if (_savedBounds) win.setBounds(_savedBounds)  // restore real geometry for next show
    }
    _animating = false
  })
}

/** Show the workspace window, animating out of the dock if it was minimized there. */
export function showWorkspace(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (_animating) return
  if (win.isVisible()) { win.focus(); return }
  const target = _savedBounds || win.getBounds()
  _animating = true
  win.setBounds(dockTarget())
  win.show()
  animateBounds(win, target, () => { _animating = false })
  win.focus()
}

export function createWorkspaceWindow(preloadPath: string): BrowserWindow {
  if (_win && !_win.isDestroyed()) { showWorkspace(_win); return _win }
  const win = new BrowserWindow({
    width: W, height: H,
    show: false,
    frame: true,  // standard macOS title bar → native traffic lights always visible
    hasShadow: true, resizable: true,
    title: 'DeskApp Workspace',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })
  attachCrashRecovery(win, 'workspace')
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'workspace' } })
  // Native macOS minimize → the macOS Dock (no dock-animation interception).
  win.on('closed', () => { _win = null; _savedBounds = null })
  _win = win
  return win
}

export function getWorkspaceWindow(): BrowserWindow | null { return _win && !_win.isDestroyed() ? _win : null }
