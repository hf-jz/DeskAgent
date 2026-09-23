import { BrowserWindow } from 'electron'

/** Keep a BrowserWindow out of the taskbar and dock */
export function keepOutOfTaskbar(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return
  win.setSkipTaskbar(true)
  // macOS: ensure it stays off the dock
  if (process.platform === 'darwin') {
    try {
      const isVisible = win.isVisible()
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      if (!isVisible) win.hide()
    } catch { /* ignore */ }
  }
}
