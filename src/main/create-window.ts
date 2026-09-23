// ── Create WORK window: a new window TYPE for creation/office tasks ──
// Distinct from the utility windows (pet/hit/dock/bubble/detail — small
// floating alwaysOnTop popups): a real work window — centered, resizable,
// normal z-order, taskbar-visible, custom traffic lights. Same family as
// the deskapp design language but a dedicated factory so its lifecycle,
// sizing and window controls stay independent.
import { BrowserWindow } from 'electron'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'
import { keepOutOfTaskbar } from './taskbar' // no-op on macOS; harmless

export interface CreatePayload { source: string; title: string; type: string }
let createPayload: CreatePayload | null = null
let workWin: BrowserWindow | null = null

export function setCreatePayload(p: CreatePayload): void { createPayload = p }
export function getCreatePayload(): CreatePayload | null { return createPayload }
export function getCreateWorkWindow(): BrowserWindow | null {
  return workWin && !workWin.isDestroyed() ? workWin : null
}

export function createCreateWindow(preloadPath: string, p: CreatePayload): BrowserWindow {
  createPayload = p
  if (getCreateWorkWindow()) { getCreateWorkWindow()!.show(); getCreateWorkWindow()!.focus(); return getCreateWorkWindow()! }
  const win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    show: false, frame: false, transparent: false,
    backgroundColor: '#0b0f14',
    hasShadow: true, resizable: true, center: true,
    // Work window: normal z-order (not alwaysOnTop), taskbar/dock-visible,
    // activateable — a work surface, not a floating popup.
    alwaysOnTop: false, skipTaskbar: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true, backgroundThrottling: false },
  })
  attachCrashRecovery(win, 'create')
  keepOutOfTaskbar(win)
  workWin = win
  win.on('closed', () => { if (workWin === win) workWin = null })
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'create' } })
  win.once('ready-to-show', () => win.show())
  return win
}

// Phase-3 sub windows (style / material / export) — SAME work-window type,
// own instance (not the singleton main window). State syncs through the
// .deskapp-create.json + main-window focus reload.
export function createCreateSubWindow(preloadPath: string, kind: string, source: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 560, height: 620,
    minWidth: 420, minHeight: 400,
    show: false, frame: false, transparent: false,
    backgroundColor: '#0b0f14',
    hasShadow: true, resizable: true, center: true,
    alwaysOnTop: false, skipTaskbar: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true, backgroundThrottling: false },
  })
  attachCrashRecovery(win, 'create-sub')
  keepOutOfTaskbar(win)
  createPayload = { source, title: '', type: kind }
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'create', sub: kind } })
  win.once('ready-to-show', () => win.show())
  return win
}
