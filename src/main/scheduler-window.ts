import { BrowserWindow } from 'electron'
import { join } from 'path'

let schedulerWindow: BrowserWindow | null = null

export function getSchedulerWindow(): BrowserWindow | null {
  return schedulerWindow
}

/** 日程/任务/项目管理 — 独立工作窗口（居中、普通层级、可缩放） */
export function openSchedulerWindow(): void {
  if (schedulerWindow && !schedulerWindow.isDestroyed()) {
    if (schedulerWindow.isMinimized()) schedulerWindow.restore()
    schedulerWindow.show()
    schedulerWindow.focus()
    return
  }

  const preloadPath = join(__dirname, '../preload/index.js')
  const htmlPath = join(__dirname, '../renderer/index.html')

  schedulerWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    frame: true,
    title: 'DeskApp 日程管理',
    backgroundColor: '#0a0f0d',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  schedulerWindow.loadFile(htmlPath, { query: { page: 'scheduler' } })

  schedulerWindow.once('ready-to-show', () => {
    schedulerWindow?.show()
  })

  schedulerWindow.on('closed', () => {
    schedulerWindow = null
  })

  console.log('[DeskApp] Scheduler window created')
}
