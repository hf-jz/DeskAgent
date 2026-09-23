import { screen, BrowserWindow } from 'electron'
import { PET_BUBBLE_SPACE } from './pet-window'

// ── Edge auto-hide ──
// The pet window is a transparent rectangle: a square pet BODY anchored to its
// bottom edge, plus a speech-bubble strip above it. Every calculation here works
// on the BODY rect, because that is the only part of the window the user can see
// or grab:
//   - hiding must leave a sliver of the BODY (not of the transparent margin) at
//     the edge, otherwise the pet vanishes with nothing to aim at;
//   - a restore position must be somewhere the body is fully on-screen, because
//     a drag can end with the pet hanging off the edge (the window is wider than
//     the body) — restoring to that raw position leaves the pet stuck at the edge.
export type EdgeState = 'visible' | 'hidden-left' | 'hidden-right' | 'hidden-top' | 'hidden-bottom'

const EDGE_THRESHOLD = 40   // px: drag release this close to a work-area edge snaps
const EDGE_PEEK = 8         // px of the pet BODY left visible while hidden
const EDGE_SHOW_DIST = 60   // px around the peek that triggers hover recall
const EDGE_POLL_MS = 200
const ANIM_MS = 200
const RESTORE_MARGIN = 8

let edgeState: EdgeState = 'visible'
let edgePoll: ReturnType<typeof setInterval> | null = null
let edgeRestoreBounds: Electron.Rectangle | null = null

// Animation generation. A newer animation cancels the pending step AND the
// onDone of the older one. Without this a snap's onDone (hide the hit window,
// start polling) can fire *after* a show's onDone (edgeState = 'visible') and
// leave the pet off-screen, unclickable and unrecallable — the "pet hides and
// can never be brought back" bug.
let animGen = 0
let animTimer: ReturnType<typeof setTimeout> | null = null

// These are set by init()
let getPetWindow: () => BrowserWindow | null | undefined = () => null
let getHitWindow: () => ({ win: BrowserWindow } | null) = () => null

export function initEdgeAutoHide(
  petWinFn: () => BrowserWindow | null | undefined,
  hitWinFn: () => ({ win: BrowserWindow } | null),
): void {
  getPetWindow = petWinFn
  getHitWindow = hitWinFn
  // The monitor runs for the app's lifetime (it is a 200ms cursor read): it is
  // what repairs a pet that ended up unreachable, so it must not disable itself
  // just because the state says "visible".
  startEdgePolling()
}

export function getEdgeState(): EdgeState {
  return edgeState
}

export function clearEdgeTimers(): void {
  if (edgePoll) { clearInterval(edgePoll); edgePoll = null }
  stopAnimation()
}

// ── window helpers ──────────────────────────────────────────────────────

function getPet(): BrowserWindow | null {
  const w = getPetWindow()
  return w && !w.isDestroyed() ? w : null
}

function getHit(): BrowserWindow | null {
  const h = getHitWindow()
  return h?.win && !h.win.isDestroyed() ? h.win : null
}

/** The visible/interactive part of the pet window (renderer: bottom-centered square). */
function petBodyRect(b: Electron.Rectangle): Electron.Rectangle {
  const size = Math.max(1, b.height - PET_BUBBLE_SPACE)
  return {
    x: Math.round(b.x + (b.width - size) / 2),
    y: b.y + b.height - size,
    width: size,
    height: size,
  }
}

function workAreaFor(b: Electron.Rectangle): Electron.Rectangle {
  const d = screen.getDisplayNearestPoint({
    x: Math.round(b.x + b.width / 2),
    y: Math.round(b.y + b.height / 2),
  })
  return d.workArea
}

function intersectArea(a: Electron.Rectangle, b: Electron.Rectangle): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function visibleArea(rect: Electron.Rectangle): number {
  let area = 0
  for (const d of screen.getAllDisplays()) area += intersectArea(rect, d.workArea)
  return area
}

function isMostlyVisible(rect: Electron.Rectangle): boolean {
  return visibleArea(rect) >= rect.width * rect.height * 0.5
}

/** Body offset inside the pet window (horizontal center, bottom-aligned). */
function bodyOffset(b: Electron.Rectangle): { x: number; y: number } {
  const body = petBodyRect(b)
  return { x: body.x - b.x, y: body.y - b.y }
}

/**
 * A restore position must be reachable: the body fully inside the work area.
 * The raw drag-end bounds are not safe (the pet can be released hanging off the
 * edge) — restoring there is what left the pet stranded half off-screen.
 */
function clampRestore(b: Electron.Rectangle, wa: Electron.Rectangle): Electron.Rectangle {
  const body = petBodyRect(b)
  const minX = wa.x + RESTORE_MARGIN
  const minY = wa.y + RESTORE_MARGIN
  const maxX = Math.max(minX, wa.x + wa.width - body.width - RESTORE_MARGIN)
  const maxY = Math.max(minY, wa.y + wa.height - body.height - RESTORE_MARGIN)
  const dx = Math.round(Math.min(Math.max(body.x, minX), maxX) - body.x)
  const dy = Math.round(Math.min(Math.max(body.y, minY), maxY) - body.y)
  return { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }
}

interface EdgeDistances { left: number; right: number; top: number; bottom: number }

function edgeDistances(body: Electron.Rectangle, wa: Electron.Rectangle): EdgeDistances {
  return {
    left: body.x - wa.x,
    right: wa.x + wa.width - (body.x + body.width),
    top: body.y - wa.y,
    bottom: wa.y + wa.height - (body.y + body.height),
  }
}

function nearestEdge(body: Electron.Rectangle, wa: Electron.Rectangle): EdgeState {
  const d = edgeDistances(body, wa)
  const min = Math.min(d.left, d.right, d.top, d.bottom)
  if (min === d.left) return 'hidden-left'
  if (min === d.right) return 'hidden-right'
  if (min === d.top) return 'hidden-top'
  return 'hidden-bottom'
}

// ── animation ───────────────────────────────────────────────────────────

function stopAnimation(): void {
  animGen++
  if (animTimer) { clearTimeout(animTimer); animTimer = null }
}

function animateBounds(
  win: BrowserWindow,
  from: Electron.Rectangle,
  to: Electron.Rectangle,
  durationMs: number,
  onDone?: () => void,
): void {
  stopAnimation()
  const gen = animGen
  const start = Date.now()
  function step(): void {
    if (gen !== animGen) return          // superseded by a newer animation
    if (win.isDestroyed()) return
    const t = Math.min((Date.now() - start) / durationMs, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * ease),
      y: Math.round(from.y + (to.y - from.y) * ease),
      width: to.width,
      height: to.height,
    })
    if (t < 1) animTimer = setTimeout(step, 16)
    else { animTimer = null; onDone?.() }
  }
  step()
}

// ── edge state ──────────────────────────────────────────────────────────

/**
 * Keep the (transparent) hit window on the pet body: while hidden that means the
 * body rect mostly off-screen with only the EDGE_PEEK sliver inside, so the
 * visible sliver stays clickable/draggable instead of being dead pixels.
 */
function placeHitWindow(body: Electron.Rectangle): void {
  const hit = getHit()
  if (!hit) return
  hit.setBounds({ x: body.x, y: body.y, width: body.width, height: body.height })
  if (!hit.isVisible()) hit.showInactive()
  hit.moveTop()
}

export function checkEdgeSnap(bounds: Electron.Rectangle): void {
  const petWin = getPet()
  if (!petWin) return
  const wa = workAreaFor(bounds)
  const body = petBodyRect(bounds)
  const d = edgeDistances(body, wa)
  if (Math.min(d.left, d.right, d.top, d.bottom) > EDGE_THRESHOLD) return
  snapToEdge(nearestEdge(body, wa), wa)
}

/** Slides the window off-screen along one axis, leaving EDGE_PEEK px of the body visible. */
function snapToEdge(state: EdgeState, wa: Electron.Rectangle): void {
  const petWin = getPet()
  if (!petWin) return
  const b = petWin.getBounds()
  const body = petBodyRect(b)
  const off = bodyOffset(b)

  edgeRestoreBounds = clampRestore(b, wa)
  edgeState = state

  let hx = b.x, hy = b.y
  switch (state) {
    case 'hidden-left': hx = Math.round(wa.x + EDGE_PEEK - body.width - off.x); break
    case 'hidden-right': hx = Math.round(wa.x + wa.width - EDGE_PEEK - off.x); break
    case 'hidden-top': hy = Math.round(wa.y + EDGE_PEEK - body.height - off.y); break
    case 'hidden-bottom': hy = Math.round(wa.y + wa.height - EDGE_PEEK - off.y); break
    default: return
  }

  animateBounds(petWin, b, { x: hx, y: hy, width: b.width, height: b.height }, ANIM_MS, () => {
    const settled = petWin.isDestroyed() ? null : petWin.getBounds()
    if (settled) placeHitWindow(petBodyRect(settled))
  })
}

export function showFromEdge(): void {
  if (edgeState === 'visible' || !edgeRestoreBounds) return
  const petWin = getPet()
  if (!petWin) return

  // Re-clamp against the *current* layout (the display the pet hid on may be
  // gone by now — unplugged monitor, resolution change).
  const dest = clampRestore(edgeRestoreBounds, workAreaFor(edgeRestoreBounds))
  // Commit the state up front: the animation can be superseded at any time and
  // the pet is already heading to a position the user can reach and grab.
  edgeState = 'visible'
  edgeRestoreBounds = null

  placeHitWindow(petBodyRect(dest))
  animateBounds(petWin, petWin.getBounds(), dest, ANIM_MS)
}

export function toggleEdgeHide(): void {
  if (edgeState !== 'visible') { showFromEdge(); return }
  const petWin = getPet()
  if (!petWin) return
  const b = petWin.getBounds()
  const wa = workAreaFor(b)
  snapToEdge(nearestEdge(petBodyRect(b), wa), wa)
}

// ── hover monitor ───────────────────────────────────────────────────────

function nearPeek(state: EdgeState, wa: Electron.Rectangle, body: Electron.Rectangle): boolean {
  const m = screen.getCursorScreenPoint()
  const inY = m.y >= body.y - 20 && m.y <= body.y + body.height + 20
  const inX = m.x >= body.x - 20 && m.x <= body.x + body.width + 20
  switch (state) {
    case 'hidden-left': return m.x <= wa.x + EDGE_PEEK + EDGE_SHOW_DIST && inY
    case 'hidden-right': return m.x >= wa.x + wa.width - EDGE_PEEK - EDGE_SHOW_DIST && inY
    case 'hidden-top': return m.y <= wa.y + EDGE_PEEK + EDGE_SHOW_DIST && inX
    case 'hidden-bottom': return m.y >= wa.y + wa.height - EDGE_PEEK - EDGE_SHOW_DIST && inX
    default: return false
  }
}

function edgeTick(): void {
  const petWin = getPet()
  if (!petWin || animTimer) return            // mid-tween: don't fight it
  const b = petWin.getBounds()
  const body = petBodyRect(b)
  const wa = workAreaFor(b)
  // Something else is driving the window right now (user drag / idle walk):
  // only repair states the pet has settled into.
  const settled = b.x === lastPetPos.x && b.y === lastPetPos.y
  lastPetPos = { x: b.x, y: b.y }

  if (edgeState === 'visible') {
    // Safety net: a "visible" pet that is (almost) entirely off the work area
    // can never be recalled (hover recall only runs while hidden) — hide it
    // properly, with a clamped restore, so hover works again.
    if (settled && !isMostlyVisible(body)) { snapToEdge(nearestEdge(body, wa), wa); return }
    const hit = getHit()
    if (hit && !hit.isVisible()) placeHitWindow(body)   // pet looked alive but ignored every click
    return
  }

  const visible = visibleArea(body)
  if (visible === 0) { showFromEdge(); return }         // display layout changed — bring it back
  if (visible >= body.width * body.height * 0.5) {      // slid back on screen (idle walk): it IS visible
    edgeState = 'visible'
    edgeRestoreBounds = null
    placeHitWindow(body)
    return
  }
  if (nearPeek(edgeState, wa, body)) showFromEdge()
}

let lastPetPos: { x: number; y: number } = { x: Number.NaN, y: Number.NaN }

function startEdgePolling(): void {
  if (edgePoll) return
  edgePoll = setInterval(edgeTick, EDGE_POLL_MS)
}
