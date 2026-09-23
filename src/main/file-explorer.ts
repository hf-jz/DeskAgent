import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync, statSync } from 'fs'

let fileExplorerWindow: BrowserWindow | null = null

export function openFileExplorer(preloadPath: string): void {
  if (fileExplorerWindow && !fileExplorerWindow.isDestroyed()) {
    fileExplorerWindow.show()
    fileExplorerWindow.focus()
    return
  }

  const isMac = process.platform === 'darwin'
  const wa = screen.getPrimaryDisplay().workArea

  fileExplorerWindow = new BrowserWindow({
    width: 680, height: 500,
    x: Math.round(wa.x + (wa.width - 680) / 2),
    y: Math.round(wa.y + (wa.height - 500) / 2),
    minWidth: 400, minHeight: 300,
    frame: true,  // standard macOS title bar → native traffic lights visible
    hasShadow: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    }
  })

  fileExplorerWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'fexplorer' } })

  fileExplorerWindow.on('closed', () => { fileExplorerWindow = null })
}

/** Open a VFS file in the system default app.
 *  - 绝对路径 (agent 回复里的 file:/abs/path): 存在且是文件即打开, 等同 Finder 双击
 *  - 相对路径: 经 vfs.safeJoin 解析到 workspace 内 (防穿越) */
export function openVfsFile(filename: string): void {
  if (typeof filename !== 'string' || !filename.trim()) return
  if (filename.startsWith('/')) {
    try { if (existsSync(filename) && statSync(filename).isFile()) shell.openPath(filename) } catch { /* ignore */ }
    return
  }
  // #13 子路径支持: docs/x.md 也要能开 — 安全校验复用 vfs.safeJoin (resolve 防穿越)
  const vfs = require('./vfs')
  const fp = vfs.safeJoin ? vfs.safeJoin(filename) : null
  if (!fp) return
  shell.openPath(fp)
}
