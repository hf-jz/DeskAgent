import { BrowserWindow, Menu, screen } from 'electron'
import { keepOutOfTaskbar } from './taskbar'
import { loadSettings } from './settings-store'
import { translate, isLang } from '../shared/locales'

let contextMenuOwner: BrowserWindow | null = null
let menuOpen = false

export function showPetContextMenu(
  petWindow: BrowserWindow,
  onNewTask: () => void,
  onSettings: () => void,
  onQuit: () => void,
  isQuitting: () => boolean,
  onClosed?: () => void
): void {
  if (menuOpen) return

  if (!contextMenuOwner || contextMenuOwner.isDestroyed()) {
    contextMenuOwner = new BrowserWindow({
      parent: petWindow,
      x: 0, y: 0, width: 1, height: 1,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: false,  // don't compete with hit window
      resizable: false,
      skipTaskbar: true,
      focusable: true,
      closable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false
    })
    contextMenuOwner.loadURL('data:text/html,<!doctype html>')
    contextMenuOwner.on('close', (event) => {
      if (!isQuitting()) {
        event.preventDefault()
        contextMenuOwner?.hide()
      }
    })
  }

  const s = loadSettings()
  const lang: 'zh' | 'en' = isLang(s.language) ? s.language : 'zh'
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: translate(lang, 'tray.newTask'), click: () => onNewTask() },
    {
      label: translate(lang, 'tray.workspace'),
      // Defer past menu tracking: macOS suppresses window activation while a
      // menu is tracking, and the pet is a non-focusable panel — so windows
      // opened synchronously here leave the app INACTIVE and the dock panel
      // swallows its first clicks. 300ms lands after the menu has closed.
      click: () => setTimeout(() => require('./gen-ui').openGenUiWindows(), 300),
    },
    { label: translate(lang, 'tray.scheduler'), click: () => setTimeout(() => require('./scheduler-window').openSchedulerWindow(), 300) },
    { type: 'separator' },
    { label: translate(lang, 'tray.settings'), click: () => onSettings() },
    { type: 'separator' },
    { label: translate(lang, 'tray.quit'), click: () => onQuit() }
  ]

  const menu = Menu.buildFromTemplate(template)

  const cursor = screen.getCursorScreenPoint()
  contextMenuOwner.setBounds({ x: cursor.x, y: cursor.y, width: 1, height: 1 })
  contextMenuOwner.show()
  keepOutOfTaskbar(contextMenuOwner)
  contextMenuOwner.focus()

  menuOpen = true
  menu.popup({
    window: contextMenuOwner,
    callback: () => {
      menuOpen = false
      if (contextMenuOwner && !contextMenuOwner.isDestroyed()) {
        contextMenuOwner.hide()
      }
      // Notify that menu closed (for hit window recovery)
      onClosed?.()
    }
  })
}
