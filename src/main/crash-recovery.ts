import { BrowserWindow } from 'electron'

/**
 * Renderer crash recovery.
 *
 * Observed 2026-07-23: a system-level GPU process kill (exit_code=9, plus a
 * simultaneous network-service crash) took down the bubble renderer and the
 * pet window's WebGL context — both windows vanished from the desktop while
 * the main process kept running as a zombie. With no recovery, a transient
 * GPU hiccup looks exactly like "the app crashed" (闪退).
 *
 * Strategy: on render-process-gone (excluding clean-exit), reload the
 * window's page after a short delay. Capped at `maxAttempts` reloads per 60s
 * so a permanently broken page can't loop forever.
 */

const attempts = new WeakMap<BrowserWindow, number[]>()

export function attachCrashRecovery(win: BrowserWindow, label: string, maxAttempts = 3): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[DeskApp] ${label} renderer gone: reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'clean-exit') return
    if (win.isDestroyed()) return

    const now = Date.now()
    const log = (attempts.get(win) ?? []).filter((t) => now - t < 60_000)
    if (log.length >= maxAttempts) {
      attempts.set(win, log)
      console.error(`[DeskApp] ${label} renderer crashed ${log.length}x within 60s — giving up reload`)
      return
    }
    log.push(now)
    attempts.set(win, log)

    setTimeout(() => {
      if (win.isDestroyed()) return
      try {
        console.log(`[DeskApp] ${label} reloading after renderer crash (attempt ${log.length})`)
        win.webContents.reload()
      } catch { /* window racing destruction */ }
    }, 500)
  })
}
