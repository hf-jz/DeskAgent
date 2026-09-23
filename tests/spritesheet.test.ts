import { describe, it, expect } from 'vitest'
import {
  FRAMES, SPRITE_ROW_ORDER, SPRITE_FPS, getSubjectFit,
  genBreath, genWalk, genLie, genSleep, genJump,
  SPRITE_COLS, SPRITE_ROWS, SPRITE_FRAME,
} from '../src/renderer/src/pet-customizer/spritesheet'

describe('frame generators', () => {
  it('idle: 6-frame breathing cycle, symmetric around scaleY 1', () => {
    const f = genBreath(6)
    expect(f).toHaveLength(6)
    expect(f[0].sy).toBeCloseTo(1, 5)
    expect(Math.max(...f.map((x) => x.sy))).toBeGreaterThan(1)
    expect(Math.min(...f.map((x) => x.sy))).toBeLessThan(1)
    const sum = f.reduce((a, x) => a + x.sy, 0)
    expect(sum / f.length).toBeCloseTo(1, 5)
  })

  it('walk: bounces up mid-cycle and tilts', () => {
    const f = genWalk(8)
    expect(f).toHaveLength(8)
    expect(f[0].ty).toBeCloseTo(0, 5)
    expect(f[2].ty).toBeLessThan(0)       // airborne mid-cycle
    expect(Math.max(...f.map((x) => Math.abs(x.rot)))).toBeGreaterThan(0)
  })

  it('lie/sleep: flattened, sleep dimmed', () => {
    for (const x of genLie(4)) expect(x.sy).toBeLessThan(0.85)
    for (const x of genSleep(4)) {
      expect(x.sy).toBeLessThan(0.85)
      expect(x.dim).toBeLessThan(1)
    }
  })

  it('jump: parabolic height with peak in the middle, returns to ground', () => {
    const f = genJump(5)
    expect(f[0].ty).toBeCloseTo(0, 5)
    expect(f[4].ty).toBeCloseTo(0, 5)
    expect(f[2].ty).toBeLessThan(f[0].ty)
  })

  it('every row has a frame table ≤ SPRITE_COLS and an fps', () => {
    expect(SPRITE_ROW_ORDER).toHaveLength(SPRITE_ROWS)
    for (const row of SPRITE_ROW_ORDER) {
      expect(FRAMES[row].length).toBeGreaterThan(0)
      expect(FRAMES[row].length).toBeLessThanOrEqual(SPRITE_COLS)
      expect(SPRITE_FPS[row]).toBeGreaterThan(0)
    }
  })
})

describe('getSubjectFit', () => {
  it('centers horizontally, floors vertically, never upscales', () => {
    const fit = getSubjectFit(50, 100, 128)
    // 82% of 128 = 104.96 > 100 → subject kept at native size
    expect(fit.h).toBeCloseTo(100, 5)
    expect(fit.w).toBeCloseTo(50, 5)
    expect(fit.x).toBeCloseTo((128 - fit.w) / 2, 5)
    expect(fit.y).toBeCloseTo(128 - fit.h, 5)
  })

  it('downscales a subject larger than the fill ratio', () => {
    const fit = getSubjectFit(200, 200, 128)
    expect(fit.w).toBeCloseTo(128 * 0.82, 5)
    expect(fit.h).toBeCloseTo(128 * 0.82, 5)
    expect(fit.x).toBeGreaterThanOrEqual(0)
  })
})

describe('sheet layout', () => {
  it('frame constant matches the shared contract', () => {
    expect(SPRITE_FRAME).toBe(128)
    expect(SPRITE_COLS).toBe(8)
    expect(SPRITE_ROWS).toBe(5)
  })
})
