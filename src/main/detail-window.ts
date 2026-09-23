// ── Detail window: standalone markdown popup — draggable across the screen ──
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { attachCrashRecovery } from './crash-recovery'
import { keepOutOfTaskbar } from './taskbar'

let detailPayload: { title: string; content: string } | null = null

export function setDetailPayload(p: { title: string; content: string }): void { detailPayload = p }
export function getDetailPayload(): { title: string; content: string } | null { return detailPayload }

export function createDetailWindow(preloadPath: string, p: { title: string; content: string }): BrowserWindow {
  detailPayload = p
  const cur = screen.getCursorScreenPoint()
  const win = new BrowserWindow({
    width: 480, height: 560,
    x: Math.round(cur.x - 240), y: Math.round(cur.y - 40),
    show: false, frame: false, transparent: false,
    backgroundColor: '#151a22',  // opaque — dragging a transparent window makes macOS recomposite per move (jank after a while)
    hasShadow: false, resizable: true, skipTaskbar: true,
    focusable: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true, backgroundThrottling: false },
  })
  // 工作窗口语义: 普通层级不置顶（不遮挡浏览器等前台应用），打开时聚焦即可
  attachCrashRecovery(win, 'detail')
  keepOutOfTaskbar(win)
  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'detail' } })
  win.once('ready-to-show', () => win.show())
  return win
}
