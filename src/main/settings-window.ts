import { BrowserWindow, app } from 'electron'
import { join } from 'path'

let settingsWindow: BrowserWindow | null = null

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow
}

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const preloadPath = join(__dirname, '../preload/index.js')
  const settingsHtmlPath = join(__dirname, '../renderer/index.html')

  settingsWindow = new BrowserWindow({
    width: 1060,
    height: 580,
    minWidth: 560,
    minHeight: 420,
    show: false,
    frame: true,
    title: 'DeskApp Settings',
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  settingsWindow.loadFile(settingsHtmlPath, { query: { page: 'settings' } })

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  console.log('[DeskApp] Settings window created')
}
