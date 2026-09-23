/**
 * Type-safe IPC wrappers for the Electron main process.
 *
 * These are thin generics around ipcMain that derive parameter/return types
 * from the central contract in ipc-channels.ts.  The `as any` casts are
 * necessary because Electron's own types use string-indexed overloads that
 * can't express our per-channel parameter variance.
 *
 * Usage:
 *   import { handleIPC, onIPC } from '../shared/ipc-main'
 *
 *   handleIPC('pet:walk', (_e, dx, durationMs) => {
 *     // dx: number, durationMs: number — inferred from contract
 *     return walkPetWindow(...) // must return number
 *   })
 *
 *   onIPC('drag-start', (_e, x, y) => {
 *     // x: number, y: number
 *   })
 */

import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import type { IpcInvokeMap, IpcSendMap } from './ipc-channels'

/**
 * Register a type-safe ipcMain.handle handler for a Request/Response channel.
 *
 * @param channel  - Must be a key of IpcInvokeMap (auto-completed by IDE)
 * @param handler  - Callback receiving (event, ...typedArgs). Return type must
 *                   match IpcInvokeMap[K]['res'].
 */
export function handleIPC<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeMap[K]['req']
  ) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>
): void {
  // Electron's ipcMain.handle has overloads up to a fixed arity, so we cast
  // through any to support our generic tuple-based args.
  // D2 #45: handler throws land in the dead-letter ring (except deadletter's
  // own channel — no recursion).
  ipcMain.handle(channel as string, (async (event: any, ...args: any[]) => {
    try {
      return await (handler as any)(event, ...args)
    } catch (err: any) {
      if (channel !== ('deadletter:list' as any)) {
        try {
          const { pushDeadLetter } = require('../main/deadletter')
          pushDeadLetter('ipc-error', String(channel), String(err?.message || err))
        } catch { /* deadletter unavailable */ }
      }
      throw err
    }
  }) as any)
}

/**
 * Register a type-safe ipcMain.on listener for a fire-and-forget channel.
 *
 * @param channel  - Must be a key of IpcSendMap
 * @param listener - Callback receiving (event, ...typedArgs)
 */
export function onIPC<K extends keyof IpcSendMap>(
  channel: K,
  listener: (event: IpcMainEvent, ...args: IpcSendMap[K]) => void
): void {
  ipcMain.on(channel as string, listener as any)
}

/**
 * Unregister a fire-and-forget listener registered via onIPC.
 * Useful for cleanup (e.g. DragHandler.cleanup).
 */
export function offIPC<K extends keyof IpcSendMap>(
  channel: K,
  listener: (event: IpcMainEvent, ...args: IpcSendMap[K]) => void
): void {
  ipcMain.removeListener(channel as string, listener as any)
}

/**
 * Send to a webContents that may be dead or dying.
 *
 * `isDestroyed()` alone is NOT enough: a crashed renderer keeps the
 * webContents object alive while its render frame is already disposed, and
 * Electron then throws "Render frame was disposed before WebFrameMain could
 * be accessed" SYNCHRONOUSLY on send. Observed 2026-07-23: a GPU-process
 * kill (exit_code=9) took the bubble renderer down mid-stream and every
 * subsequent onChunk/onReasoning send threw — thousands of error lines, and
 * the exceptions broke the bridge event loop's assumptions.
 */
export function safeSend(
  wc: Electron.WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!wc) return
  try {
    if (wc.isDestroyed() || wc.isCrashed()) return
    wc.send(channel, ...args)
  } catch { /* frame disposed mid-flight — drop the event */ }
}
