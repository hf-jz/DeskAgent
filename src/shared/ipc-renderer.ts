/**
 * Type-safe IPC wrappers for the preload script.
 *
 * These thin generics wrap ipcRenderer so the preload can build the
 * deskAppAPI object with full compile-time type checking. Parameter
 * and return types are derived from the central contract in
 * ipc-channels.ts.
 *
 * Usage:
 *   import { invokeIPC, sendIPC, onPush } from '../shared/ipc-renderer'
 *
 *   // Request/Response
 *   const bounds = await invokeIPC('pet-bounds')         // → Electron.Rectangle | null
 *   const n     = await invokeIPC('pet:walk', 100, 500)  // → number
 *
 *   // Fire-and-forget
 *   sendIPC('drag-start', 100, 200)
 *
 *   // Push events (returns cleanup function)
 *   const unsub = onPush('task:chunk', (text) => { ... })
 *   // text: string — inferred from contract
 *   unsub()
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcInvokeMap, IpcSendMap, IpcPushMap } from './ipc-channels'

/**
 * Type-safe ipcRenderer.invoke for Request/Response channels.
 *
 * @param channel - Must be a key of IpcInvokeMap (IDE auto-completes)
 * @param args    - Spread of typed arguments derived from IpcInvokeMap[K]['req']
 * @returns       - Promise resolving to IpcInvokeMap[K]['res']
 */
export function invokeIPC<K extends keyof IpcInvokeMap>(
  channel: K,
  ...args: IpcInvokeMap[K]['req']
): Promise<IpcInvokeMap[K]['res']> {
  // Cast through string/any because Electron's ipcRenderer.invoke has
  // fixed-arity overloads that can't express our generic tuple args.
  return ipcRenderer.invoke(channel as string, ...args) as Promise<IpcInvokeMap[K]['res']>
}

/**
 * Type-safe ipcRenderer.send for fire-and-forget channels.
 *
 * @param channel - Must be a key of IpcSendMap
 * @param args    - Spread of typed arguments derived from IpcSendMap[K]
 */
export function sendIPC<K extends keyof IpcSendMap>(
  channel: K,
  ...args: IpcSendMap[K]
): void {
  ipcRenderer.send(channel as string, ...args)
}

/**
 * Type-safe listener for Main→Renderer push events.
 * Returns a cleanup function to remove the listener.
 *
 * @param channel  - Must be a key of IpcPushMap
 * @param callback - Receives the typed payload (no IpcRendererEvent noise)
 * @returns        - Cleanup function: call to unsubscribe
 *
 * Example:
 *   const unsub = onPush('settings-changed', (settings) => {
 *     console.log(settings.size)  // 'S' | 'M' | 'L'
 *   })
 */
export function onPush<K extends keyof IpcPushMap>(
  channel: K,
  callback: (...args: IpcPushMap[K]) => void
): () => void {
  const handler = (_e: IpcRendererEvent, ...args: IpcPushMap[K]) => {
    callback(...args)
  }
  ipcRenderer.on(channel as string, handler)
  return () => {
    ipcRenderer.removeListener(channel as string, handler)
  }
}
