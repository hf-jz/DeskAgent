import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// edge-auto-hide 只依赖 electron 的 screen/BrowserWindow —— 用假窗口 + 假显示器驱动状态机。
const WA = { x: 0, y: 30, width: 1920, height: 1250 }   // workArea (menu bar 30px)
let cursor = { x: 900, y: 600 }

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: () => ({ workArea: WA }),
    getAllDisplays: () => [{ workArea: WA }],
  },
}))
vi.mock('../src/main/pet-window', () => ({ PET_BUBBLE_SPACE: 92 }))

import {
  initEdgeAutoHide, checkEdgeSnap, toggleEdgeHide, showFromEdge, getEdgeState, clearEdgeTimers,
} from '../src/main/edge-auto-hide'

type Rect = { x: number; y: number; width: number; height: number }

class FakeWin {
  bounds: Rect
  visible = true
  destroyed = false
  moves = 0
  constructor(b: Rect) { this.bounds = { ...b } }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  getBounds() { return { ...this.bounds } }
  setBounds(b: Rect) { this.bounds = { ...b }; this.moves++ }
  showInactive() { this.visible = true }
  hide() { this.visible = false }
  moveTop() {}
}

const BODY = 120, WIN_W = 220, WIN_H = BODY + 92
let pet: FakeWin
let hit: FakeWin

/** pet window whose body sits with its left edge at bodyX / top at bodyY */
function placeOnScreen(bodyX: number, bodyY: number): void {
  pet.bounds = { x: bodyX - (WIN_W - BODY) / 2, y: bodyY - (WIN_H - BODY), width: WIN_W, height: WIN_H }
  hit.bounds = { x: bodyX, y: bodyY, width: BODY, height: BODY }
}
const petBody = (): Rect => {
  const b = pet.bounds
  return { x: b.x + (b.width - BODY) / 2, y: b.y + b.height - BODY, width: BODY, height: BODY }
}
const bodyVisible = (): boolean => {
  const b = petBody()
  return b.x >= WA.x && b.y >= WA.y && b.x + b.width <= WA.x + WA.width && b.y + b.height <= WA.y + WA.height
}
/** run the 200ms tween + one poll tick */
const settle = (): void => { vi.advanceTimersByTime(1000) }

beforeEach(() => {
  vi.useFakeTimers()
  pet = new FakeWin({ x: 800, y: 400, width: WIN_W, height: WIN_H })
  hit = new FakeWin({ x: 850, y: 492, width: BODY, height: BODY })
  initEdgeAutoHide(() => pet as any, () => ({ win: hit as any }))
  cursor = { x: 900, y: 600 }
})

afterEach(() => {
  clearEdgeTimers()
  vi.useRealTimers()
})

describe('edge auto-hide — pet must always be recoverable', () => {
  it('hiding leaves a sliver of the BODY (not the transparent margin) at the edge', () => {
    placeOnScreen(1200, 600)          // body right edge at 1320, far from the edge
    checkEdgeSnap(pet.bounds)
    expect(getEdgeState()).toBe('visible')   // 60px away — no snap

    placeOnScreen(1790, 600)          // body right edge at 1910 -> 10px from right edge
    checkEdgeSnap(pet.bounds)
    expect(getEdgeState()).toBe('hidden-right')
    settle()

    const b = petBody()
    // peeks EDGE_PEEK px of the body inside the screen, body otherwise off-screen
    expect(WA.x + WA.width - b.x).toBe(8)
    expect(b.x + b.width).toBeGreaterThan(WA.x + WA.width)
    // the hit window stays on the visible sliver so the peek can be grabbed
    expect(hit.visible).toBe(true)
    expect(hit.bounds.x).toBe(b.x)
  })

  it('recall restores the pet FULLY on-screen even when released hanging off the edge', () => {
    placeOnScreen(1869, 600)          // body spans 1869..1989 -> 51px past the screen edge
    checkEdgeSnap(pet.bounds)
    expect(getEdgeState()).toBe('hidden-right')
    settle()

    cursor = { x: 1910, y: 650 }      // hover the right edge
    vi.advanceTimersByTime(200)       // one poll tick
    expect(getEdgeState()).toBe('visible')
    settle()

    expect(bodyVisible()).toBe(true)  // <-- the bug: raw drag-end bounds restored it half off-screen
    expect(hit.bounds).toEqual(petBody())
  })

  it('hover recall keeps working after a recall (poll must not disable itself)', () => {
    placeOnScreen(1790, 600)
    checkEdgeSnap(pet.bounds)
    settle()
    cursor = { x: 1910, y: 650 }
    vi.advanceTimersByTime(200)
    settle()
    expect(getEdgeState()).toBe('visible')

    // drag it to the edge again and recall again — the third round must still work
    cursor = { x: 900, y: 600 }
    settle()
    placeOnScreen(1916, 600)
    checkEdgeSnap(pet.bounds)
    settle()
    expect(getEdgeState()).toBe('hidden-right')
    cursor = { x: 1900, y: 650 }
    vi.advanceTimersByTime(200)
    settle()
    expect(getEdgeState()).toBe('visible')
    expect(bodyVisible()).toBe(true)
  })

  it('repairs a desynced state: pet off-screen / hit window hidden / state says visible', () => {
    // 1) hit window lost while the pet is plainly visible (animation race symptom)
    placeOnScreen(1200, 600)
    hit.hide()
    vi.advanceTimersByTime(200)
    expect(hit.visible).toBe(true)

    // 2) state "visible" but the pet is off the work area -> must become recallable
    pet.bounds = { x: WA.x + WA.width - 4, y: 400, width: WIN_W, height: WIN_H }
    vi.advanceTimersByTime(400)       // two ticks: the guard ignores the tick that sees the jump
    expect(getEdgeState()).toBe('hidden-right')
    settle()

    cursor = { x: 1912, y: 500 }
    vi.advanceTimersByTime(200)
    settle()
    expect(getEdgeState()).toBe('visible')
    expect(bodyVisible()).toBe(true)
  })

  it('Cmd+Shift+H toggles without stranding the pet off-screen', () => {
    placeOnScreen(400, 300)
    toggleEdgeHide()                  // hide against the nearest edge
    const hidden = getEdgeState()
    expect(hidden.startsWith('hidden')).toBe(true)
    toggleEdgeHide()                  // show again
    settle()
    expect(getEdgeState()).toBe('visible')
    expect(bodyVisible()).toBe(true)
    expect(hit.visible).toBe(true)
  })

  it('a newer animation cancels the older one (no stale onDone)', () => {
    placeOnScreen(1790, 600)
    checkEdgeSnap(pet.bounds)         // snap animation starts (pet leaves the screen)
    vi.advanceTimersByTime(60)        // 60ms in: user toggles back
    showFromEdge()
    settle()
    expect(getEdgeState()).toBe('visible')
    expect(bodyVisible()).toBe(true)  // snap's tween must not win and finish off-screen
    expect(hit.visible).toBe(true)    // ...and must not hide the hit window on the way
  })
})
