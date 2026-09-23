import { BrowserWindow } from 'electron'
import { attachCrashRecovery } from './crash-recovery'

export interface HitWindow { win: BrowserWindow }

export interface HitWindowOptions {
  preloadPath: string
  hitHtmlPath: string
  petWindow: BrowserWindow
  bodySize: number
  isMac: boolean
  isLinux: boolean
  isWin: boolean
}

export function createHitWindow(options: HitWindowOptions): HitWindow {
  const { preloadPath, hitHtmlPath, petWindow, bodySize, isMac } = options

  // Cover only the pet body (bottom square of the pet window) so the bubble
  // strip above the pet stays click-through.
  const bounds = petWindow.getBounds()
  const w = bodySize
  const h = bodySize
  const x = bounds.x + Math.round((bounds.width - w) / 2)
  const y = bounds.y + bounds.height - h

  const win = new BrowserWindow({
    width: w, height: h,
    x, y,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    fullscreenable: false, enableLargerThanScreen: true,
    focusable: true,
    ...(isMac ? { type: 'panel' as const, roundedCorners: false } : {}),
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
      sandbox: false,
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  win.setIgnoreMouseEvents(false)
  attachCrashRecovery(win, 'hit')
  win.loadFile(hitHtmlPath)
  win.showInactive()
  win.moveTop()
  win.setSkipTaskbar(true)

  console.log('[DeskApp] Hit window created')
  return { win }
}

export function showPetWindows(petWin: BrowserWindow | null | undefined, hitWin: BrowserWindow | null | undefined): void {
  if (!petWin || petWin.isDestroyed()) return
  if (!hitWin || hitWin.isDestroyed()) return
  hitWin.show()
  petWin.showInactive()
  hitWin.moveTop()
}

export function hidePetWindows(petWin: BrowserWindow | null | undefined, hitWin: BrowserWindow | null | undefined): void {
  petWin?.hide()
  hitWin?.hide()
}
