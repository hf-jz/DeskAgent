import { BrowserWindow, screen } from 'electron'
import { attachCrashRecovery } from './crash-recovery'
import { getBubbleWindows } from './task-bubble'

export interface PetWindow { win: BrowserWindow }

export interface PetWindowOptions {
  preloadPath: string
  loadFilePath: string
  width?: number
  height?: number
  isMac: boolean
  isLinux: boolean
  isWin: boolean
}

// The pet window is a transparent rectangle: the bottom square hosts the pet
// body, the strip above is reserved for its speech bubble ("from the pet's
// mouth"). Keep in sync with BUBBLE_SPACE in src/renderer/src/pet/PetApp.tsx.
export const PET_WINDOW_WIDTH = 220
export const PET_BUBBLE_SPACE = 92

export function createPetWindow(options: PetWindowOptions): PetWindow {
  const { preloadPath, loadFilePath, isMac, isLinux, width, height } = options
  const body = Math.min(width || 120, height || 120)
  const winWidth = PET_WINDOW_WIDTH
  const winHeight = body + PET_BUBBLE_SPACE

  const win = new BrowserWindow({
    width: winWidth, height: winHeight,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    fullscreenable: false, enableLargerThanScreen: true,
    focusable: false,
    ...(isMac ? { type: 'panel' as const, roundedCorners: false } : {}),
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
      sandbox: false,
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // The hit window (pet body area only) captures all input; the pet window
  // itself must be click-through so the bubble strip and the transparent
  // margins never block the desktop underneath.
  win.setIgnoreMouseEvents(true)

  // GPU kills (exit_code=9) take the pet's WebGL renderer down — reload
  // brings the pet back instead of leaving an invisible window.
  attachCrashRecovery(win, 'pet')

  win.loadFile(loadFilePath)
  win.showInactive()
  win.setSkipTaskbar(true)

  if (isLinux) {
    win.on('close', (event) => {
      event.preventDefault()
      if (!win.isVisible()) { win.showInactive(); win.setSkipTaskbar(true) }
    })
  }

  console.log('[DeskApp] Pet window created (rect,', winWidth + 'x' + winHeight + ', body ' + body + 'px)')
  return { win }
}

// ── Pet walking ─────────────────────────────────────────────────────────
// The renderer drives the pose (crawl paddling); the main process slides
// both windows horizontally so the pet actually walks across the desktop.
let petWalkTimer: NodeJS.Timeout | null = null

export function stopPetWalk(): void {
  if (petWalkTimer) { clearInterval(petWalkTimer); petWalkTimer = null }
}

/**
 * Slide the pet window (and its hit window) horizontally by `dx` over
 * `durationMs`, clamped inside the work area. Returns the actual dx after
 * clamping (0 when already against the edge).
 */
export function walkPetWindow(petWin: BrowserWindow, hitWin: BrowserWindow | null, dx: number, durationMs: number): number {
  stopPetWalk()
  if (petWin.isDestroyed()) return 0
  const b = petWin.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  let minX = wa.x
  let maxX = wa.x + wa.width - b.width
  // Never walk over an open bubble window. The pet (and its hit window) are
  // always-on-top, so parking on the chat window covers it and the hit window
  // swallows every click there — the click meant for the input becomes a pet
  // click (new bubble) and any in-progress IME composition dies.
  for (const bw of getBubbleWindows()) {
    const r = bw.getBounds()
    if (r.y + r.height < b.y || r.y > b.y + b.height) continue     // different row — ignore
    if (b.x >= r.x && b.x + b.width <= r.x + r.width) return 0     // already on it — stay put
    if (b.x + b.width <= r.x) maxX = Math.min(maxX, r.x - b.width)  // pet is left of the bubble
    else minX = Math.max(minX, r.x + r.width)                       // pet is right of the bubble
  }
  if (maxX < minX) return 0                                         // boxed in by bubbles — stay put
  const targetX = Math.round(Math.min(Math.max(b.x + dx, minX), maxX))
  const actualDx = targetX - b.x
  if (actualDx === 0) return 0

  const startX = b.x
  const startY = b.y
  const started = Date.now()
  petWalkTimer = setInterval(() => {
    if (petWin.isDestroyed()) { stopPetWalk(); return }
    const t = Math.min(1, (Date.now() - started) / durationMs)
    // ease-in-out so the walk starts and ends gently
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const x = Math.round(startX + actualDx * e)
    petWin.setPosition(x, startY)
    if (hitWin && !hitWin.isDestroyed()) {
      const hb = hitWin.getBounds()
      hitWin.setPosition(
        x + Math.round((b.width - hb.width) / 2),
        startY + b.height - hb.height,
      )
    }
    if (t >= 1) stopPetWalk()
  }, 33)
  return actualDx
}
