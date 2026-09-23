import { BrowserWindow } from 'electron'
import { stopPetWalk } from './pet-window'
import { onIPC, offIPC } from '../shared/ipc-main'

export interface DragHandler { cleanup: () => void }

export interface DragHandlerOptions {
  petWindow: BrowserWindow
  hitWindow: BrowserWindow
  screen: Electron.Screen
  onDragEnd?: (finalBounds: Electron.Rectangle) => void
}

export function createDragHandler(options: DragHandlerOptions): DragHandler {
  const { petWindow, hitWindow, onDragEnd } = options

  let dragging = false

  function handleDragStart(): void { stopPetWalk(); dragging = true }
  function handleDragMove(_e: Electron.IpcMainEvent, dx: number, dy: number): void {
    if (!dragging || petWindow.isDestroyed()) return
    const b = petWindow.getBounds()
    petWindow.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height })
    if (hitWindow.isDestroyed()) return
    const hb = hitWindow.getBounds()
    // Hit window stays anchored to the pet body: horizontally centered on the
    // pet window, vertically aligned to its bottom edge.
    hitWindow.setBounds({
      x: Math.round(b.x + dx + (b.width - hb.width) / 2),
      y: Math.round(b.y + dy + (b.height - hb.height)),
      width: hb.width, height: hb.height
    })
  }
  function handleDragEnd(): void {
    dragging = false
    if (onDragEnd && !petWindow.isDestroyed()) {
      onDragEnd(petWindow.getBounds())
    }
  }

  // Generic window drag (studio view): main polls the OS cursor and follows it
  // at 30Hz. ponytail: the card/detail windows switched to CSS
  // `-webkit-app-region: drag` (system-driven, perfectly smooth every drag —
  // the polling loop backlogs the window server on long drags → escalating
  // jank from the second drag on). The studio keeps the polling only because
  // its canvas needs every mouse event (an app-region drag would eat them).
  let windowDrag: { win: BrowserWindow; ox: number; oy: number; timer: NodeJS.Timeout } | null = null

  function stopWindowDrag(): void {
    if (windowDrag) { clearInterval(windowDrag.timer); windowDrag = null }
  }

  function handleWindowDragStart(e: Electron.IpcMainEvent): void {
    stopWindowDrag()
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    const p = options.screen.getCursorScreenPoint()
    const b = win.getBounds()
    let last = { x: p.x, y: p.y }
    windowDrag = {
      win, ox: p.x - b.x, oy: p.y - b.y,
      timer: setInterval(() => {
        if (win.isDestroyed()) { stopWindowDrag(); return }
        const cp = options.screen.getCursorScreenPoint()
        if (cp.x === last.x && cp.y === last.y) return
        last = cp
        const wb = win.getBounds()
        // ponytail: a mouseup that lands outside the window never reaches the
        // renderer → the interval would run forever and the NEXT drag would
        // escalate. Stop when the cursor leaves the window bounds + 100px
        // margin (a fast flick briefly outruns the window — margin keeps the
        // drag alive; the center-distance variant killed edge-grabbed drags).
        const outside = cp.x < wb.x - 100 || cp.x > wb.x + wb.width + 100 ||
          cp.y < wb.y - 100 || cp.y > wb.y + wb.height + 100
        if (outside) {
          stopWindowDrag()
          return
        }
        const wa = options.screen.getDisplayNearestPoint(cp).workArea
        const clamped = wb.x <= wa.x + 1 || wb.y <= wa.y + 1 ||
          wb.x + wb.width >= wa.x + wa.width - 1 || wb.y + wb.height >= wa.y + wa.height - 1
        if (clamped && (cp.x < wb.x || cp.x >= wb.x + wb.width || cp.y < wb.y || cp.y >= wb.y + wb.height)) {
          stopWindowDrag()
          return
        }
        const nx = cp.x - windowDrag!.ox, ny = cp.y - windowDrag!.oy
        // Edge-clamped: the OS refuses the move — skip the redundant
        // setPosition (it churns the window server → edge drag lag).
        if (nx === wb.x && ny === wb.y) return
        win.setPosition(nx, ny)
      }, 32),
    }
  }

  function handleWindowDragEnd(): void { stopWindowDrag() }

  onIPC('drag-start', handleDragStart)
  onIPC('drag-move', handleDragMove)
  onIPC('drag-end', handleDragEnd)
  onIPC('win:drag-start', handleWindowDragStart)
  onIPC('win:drag-end', handleWindowDragEnd)

  return {
    cleanup: () => {
      stopWindowDrag()
      offIPC('drag-start', handleDragStart)
      offIPC('drag-move', handleDragMove)
      offIPC('drag-end', handleDragEnd)
      offIPC('win:drag-start', handleWindowDragStart)
      offIPC('win:drag-end', handleWindowDragEnd)
    }
  }
}
