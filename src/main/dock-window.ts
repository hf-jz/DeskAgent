// ── Dock bar: thin frameless glass window at screen right edge ──
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'

const isMac = process.platform === 'darwin'
// Coverflow deck needs width — 560px transparent strip: active card (scaled
// 1.08 + shadow) keeps a visible margin off the window's left edge, and the
// 7th card (diff6, x=234) still fits on the right.
export const DOCK_W = 425

let _dock: BrowserWindow | null = null

export function createDockWindow(preloadPath: string): BrowserWindow {
  if (_dock && !_dock.isDestroyed()) return _dock
  const display = screen.getPrimaryDisplay()
  const { height, y } = display.workArea
  // ponytail: dock height = 1.1 × dock card height (CARD_H 340 in DockApp.tsx).
  // Duplicated constant — reconcile if the deck is resized again.
  const dh = Math.round(340 * 1.1)
  // Top extended +8% (30px) so the traffic lights sit above the deck without clipping.
  const topPad = Math.round(dh * 0.08)

  const win = new BrowserWindow({
    width: DOCK_W, height: dh + topPad,
    x: Math.round(display.workArea.x + display.workArea.width - DOCK_W),
    y: Math.round(y + (height - dh) / 2 - topPad),
    show: false,
    frame: false, transparent: true,
    hasShadow: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
    // ponytail: deliberately NOT type:'panel' — macOS panels swallow the
    // first mousedown as an activation click (observed: play button dead
    // until the app was activated via another window). A plain alwaysOnTop
    // window delivers the first click; skipTaskbar keeps it out of the dock.
  })
  attachCrashRecovery(win, 'dock')
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'dock' } })
  win.on('closed', () => { _dock = null })
  _dock = win
  return win
}

export function getDockWindow(): BrowserWindow | null {
  return _dock && !_dock.isDestroyed() ? _dock : null
}
