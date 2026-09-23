import { describe, it, expect } from 'vitest'
import {
  autoMatte, computeBBox, floodFillBackground, largestComponent,
  paintBrush, pickTolerance, posterize, fillHoles, keepMajorComponents, dilate,
} from '../src/renderer/src/pet-customizer/matting'

/** Build a w×h RGBA buffer; fill all pixels with `base` then paint a rect. */
function makeImage(w: number, h: number, base: [number, number, number], rect?: { x: number; y: number; w: number; h: number; c: [number, number, number] }): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = base[0]
    rgba[i * 4 + 1] = base[1]
    rgba[i * 4 + 2] = base[2]
    rgba[i * 4 + 3] = 255
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = y * w + x
        rgba[i * 4] = rect.c[0]
        rgba[i * 4 + 1] = rect.c[1]
        rgba[i * 4 + 2] = rect.c[2]
      }
    }
  }
  return rgba
}

describe('floodFillBackground', () => {
  it('marks the border-connected background, keeps the centered subject', () => {
    // 8×8, white bg, red 2×2 subject in the middle
    const rgba = makeImage(8, 8, [255, 255, 255], { x: 3, y: 3, w: 2, h: 2, c: [255, 0, 0] })
    const bg = floodFillBackground(rgba, 8, 8, 20)
    // bg pixels: everything except the red 2×2
    for (let i = 0; i < 64; i++) {
      const x = i % 8, y = Math.floor(i / 8)
      const inSubject = x >= 3 && x < 5 && y >= 3 && y < 5
      expect(bg[i]).toBe(inSubject ? 0 : 255)
    }
  })

  it('treats transparent pixels as background', () => {
    const rgba = makeImage(4, 4, [255, 255, 255])
    rgba[0] = 0; rgba[1] = 0; rgba[2] = 0; rgba[3] = 0 // corner pixel transparent
    const bg = floodFillBackground(rgba, 4, 4, 10)
    expect(bg[0]).toBe(255)
  })
})

describe('largestComponent', () => {
  it('keeps only the largest connected region', () => {
    const W = 6
    const fg = new Uint8Array(W * W)
    // big component: 4×4 block in the top-left corner
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fg[y * W + x] = 255
    // small island: isolated pixel in the bottom-right (not 4-adjacent)
    fg[5 * W + 5] = 255
    const out = largestComponent(fg, W, W)
    expect(out[5 * W + 5]).toBe(0)
    expect(out[0]).toBe(255)
    expect(out[3 * W + 3]).toBe(255)
  })
})

describe('autoMatte', () => {
  it('extracts the subject bbox and ratio (pipeline: major components + holes + dilate)', () => {
    const rgba = makeImage(10, 10, [200, 200, 200], { x: 2, y: 1, w: 4, h: 3, c: [10, 200, 10] })
    const res = autoMatte(rgba, 10, 10, 20)
    // dilate(1) grows the 4×3 subject by one pixel each side
    expect(res.bbox).toEqual({ x: 1, y: 0, w: 6, h: 5 })
    // 12 subject px + 14 dilated ring px = 26 / 100
    expect(res.fgRatio).toBeCloseTo(0.26, 5)
    expect(res.mask.length).toBe(100)
  })

  it('returns null bbox when everything is background', () => {
    const rgba = makeImage(6, 6, [128, 128, 128])
    const res = autoMatte(rgba, 6, 6, 30)
    expect(res.bbox).toBeNull()
    expect(res.fgRatio).toBe(0)
  })
})

describe('pickTolerance', () => {
  it('finds a tolerance that lands in the sane foreground band', () => {
    const rgba = makeImage(20, 20, [250, 250, 250], { x: 5, y: 5, w: 10, h: 10, c: [30, 30, 200] })
    const t = pickTolerance(rgba, 20, 20)
    const res = autoMatte(rgba, 20, 20, t)
    expect(res.bbox).not.toBeNull()
    expect(res.fgRatio).toBeGreaterThanOrEqual(0.12)
    expect(res.fgRatio).toBeLessThanOrEqual(0.75)
  })
})

describe('paintBrush', () => {
  it('erases and restores inside the circle', () => {
    const mask = new Uint8Array(9 * 9).fill(255)
    paintBrush(mask, 9, 9, 4, 4, 3, 'erase')
    expect(mask[4 * 9 + 4]).toBe(0)       // center erased
    expect(mask[0]).toBe(255)             // corner untouched (dist²=32 > 9)
    expect(mask[4 * 9 + 8]).toBe(255)     // dist=4 > r, outside circle
    paintBrush(mask, 9, 9, 4, 4, 3, 'restore')
    expect(mask[4 * 9 + 4]).toBe(255)
  })
})

describe('computeBBox', () => {
  it('returns null for an empty mask', () => {
    expect(computeBBox(new Uint8Array(16), 4, 4)).toBeNull()
  })
})

describe('posterize', () => {
  it('quantizes RGB channels but keeps alpha', () => {
    const rgba = new Uint8ClampedArray([120, 130, 140, 255])
    posterize(rgba, 4, 0) // 4 levels → step 64
    expect(rgba[0] % 64).toBe(0)
    expect(rgba[3]).toBe(255)
  })
})

describe('fillHoles', () => {
  it('fills foreground-internal gaps but keeps border-connected background', () => {
    const W = 7
    const mask = new Uint8Array(W * W).fill(255) // solid foreground
    // carve a 1px hole fully surrounded by foreground
    mask[3 * W + 3] = 0
    // carve a notch at the border (must stay background)
    mask[0] = 0
    const out = fillHoles(mask, W, W)
    expect(out[3 * W + 3]).toBe(255) // hole filled
    expect(out[0]).toBe(0)            // border-connected bg untouched
  })
})

describe('keepMajorComponents', () => {
  it('keeps components ≥ 15% of the largest, drops the tiny island', () => {
    const W = 8
    const fg = new Uint8Array(W * W)
    // big block 4×4 (16 px)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fg[y * W + x] = 255
    // medium block 3×2 (6 px) — 37% of largest → kept
    for (let y = 0; y < 3; y++) for (let x = 5; x < 7; x++) fg[y * W + x] = 255
    // tiny island 1 px — dropped
    fg[7 * W + 7] = 255
    const out = keepMajorComponents(fg, W, W, 0.15)
    expect(out[0]).toBe(255)
    expect(out[5]).toBe(255)      // medium kept
    expect(out[7 * W + 7]).toBe(0) // tiny dropped
  })
})

describe('dilate', () => {
  it('grows the foreground by 1px around the edge', () => {
    const mask = new Uint8Array(5 * 5)
    mask[2 * 5 + 2] = 255 // single center pixel
    const out = dilate(mask, 5, 5, 1)
    expect(out[2 * 5 + 2]).toBe(255)
    expect(out[2 * 5 + 1]).toBe(255) // left neighbor filled
    expect(out[0]).toBe(0)            // corner (dist √8 > 1) untouched
  })
})
