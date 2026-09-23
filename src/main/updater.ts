// ── D1 #44 / P1 #22: update checker (electron-updater) ──
// Checks 15s after launch, then every 30min. Never auto-installs — surfaces
// status to the settings window; unsigned/feedless builds degrade to a
// "download manually" link instead of pretending auto-update works.
import { app, BrowserWindow } from 'electron'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let status: UpdateStatus = { state: 'idle' }
let updater: typeof import('electron-updater').autoUpdater | null = null
let timer: ReturnType<typeof setInterval> | null = null

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('update:status', status) } catch { /* gone */ }
  }
}

function setStatus(s: UpdateStatus): void {
  status = s
  broadcast()
}

export function getUpdateStatus(): UpdateStatus { return status }

export function initUpdater(getSettings: () => { dismissedUpdateVersion?: string }): void {
  if (!app.isPackaged) return // dev builds have no feed to talk to
  let u: typeof import('electron-updater').autoUpdater
  try {
    u = require('electron-updater').autoUpdater
  } catch { return } // dep absent — stay idle
  updater = u
  u.autoDownload = false
  u.autoInstallOnAppQuit = false

  u.on('checking-for-update', () => setStatus({ state: 'checking' }))
  u.on('update-available', (info: { version: string }) => {
    const dismissed = getSettings().dismissedUpdateVersion
    if (dismissed === info.version) { setStatus({ state: 'idle' }); return }
    setStatus({ state: 'available', version: info.version })
  })
  u.on('update-not-available', () => setStatus({ state: 'idle' }))
  u.on('download-progress', (p: { percent: number }) =>
    setStatus({ state: 'downloading', percent: Math.round(p.percent) }))
  u.on('update-downloaded', (info: { version: string }) =>
    setStatus({ state: 'downloaded', version: info.version }))
  u.on('error', (err: Error) => setStatus({ state: 'error', message: String(err?.message || err) }))

  const check = (): void => { updater?.checkForUpdates().catch(() => setStatus({ state: 'idle' })) }
  setTimeout(check, 15_000)
  timer = setInterval(check, 30 * 60_000)
}

export function downloadUpdate(): void { updater?.downloadUpdate().catch(() => {}) }

/** Manual re-check from the settings UI (does not re-init the timer). */
export function checkNow(): void {
  try { updater?.checkForUpdates().catch(() => {}) } catch { /* not initialized */ }
}

export function installUpdate(): void {
  try { updater?.quitAndInstall() } catch { /* unsigned — see banner fallback */ }
}

export function stopUpdater(): void { if (timer) clearInterval(timer) }
