import { describe, it, expect } from 'vitest'
import {
  U2NET_INPUT, THRESHOLD, preprocess, postprocess, postprocessAvg, resizeNearest, resizeRGB, sigmoid,
} from '../src/renderer/src/pet-customizer/segnet-core'

describe('resizeNearest', () => {
  it('scales a 2×2 grid up to 4×4 by duplicating pixels', () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4])
    const out = resizeNearest(src, 2, 2, 4, 4)
    expect(out[0]).toBe(1)            // top-left quadrant
    expect(out[3]).toBe(2)            // top-right
    expect(out[12]).toBe(3)           // bottom-left
    expect(out[15]).toBe(4)           // bottom-right
  })
})

describe('resizeRGB', () => {
  it('drops alpha and resizes', () => {
    // 1×1 RGBA pixel (10,20,30,255)
    const rgba = new Uint8ClampedArray([10, 20, 30, 255])
    const out = resizeRGB(rgba, 1, 1, 2, 2)
    expect(out).toHaveLength(2 * 2 * 3)
    expect(out[0]).toBe(10)
    expect(out[4]).toBe(20)
    expect(out[8]).toBe(30)
  })
})

describe('preprocess', () => {
  it('produces (1,3,320,320) NCHW float32 normalized to 0..1', () => {
    const rgba = new Uint8ClampedArray(1 * 1 * 4).fill(0)
    rgba[0] = 255; rgba[1] = 128; rgba[2] = 0 // red-ish pixel
    const out = preprocess(rgba, 1, 1)
    expect(out).toHaveLength(3 * U2NET_INPUT * U2NET_INPUT)
    const n = U2NET_INPUT * U2NET_INPUT
    expect(out[0]).toBeCloseTo(1, 5)       // R channel first pixel
    expect(out[n]).toBeCloseTo(128 / 255, 5)
    expect(out[2 * n]).toBeCloseTo(0, 5)
  })
})

describe('postprocess', () => {
  it('sigmoid-thresholds logits and resizes back to the original size', () => {
    const n = U2NET_INPUT * U2NET_INPUT
    const logits = new Float32Array(n).fill(-10) // strong background
    logits[0] = 10                               // strong foreground
    const mask = postprocess(logits, 64, 48)
    expect(mask).toHaveLength(64 * 48)
    expect(mask[0]).toBe(255)   // top-left (strong fg) survived
    expect(mask[64 * 47]).toBe(0)
  })

  it('sigmoid maps 0 → 0.5 exactly', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 5)
    expect(sigmoid(10)).toBeGreaterThan(THRESHOLD)
    expect(sigmoid(-10)).toBeLessThan(THRESHOLD)
  })

  it('postprocessAvg averages logits across heads before thresholding', () => {
    const n = U2NET_INPUT * U2NET_INPUT
    // head 1: strong foreground everywhere; head 2: strong background everywhere
    const h1 = new Float32Array(n).fill(100)
    const h2 = new Float32Array(n).fill(-100)
    // both heads agree on a 20×20 background block in the top-left corner
    // (block must survive the 320→32 nearest-neighbor sampling: (0,0) maps to 10×10)
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = y * U2NET_INPUT + x
        h1[i] = -100
        h2[i] = -100
      }
    }
    const mask = postprocessAvg([h1, h2], 32, 32)
    // top-left: avg logit -100 → background
    expect(mask[0]).toBe(0)
    // elsewhere: avg logit 0 → sigmoid 0.5 ≥ 0.4 → fg (disagreement keeps both)
    expect(mask[32 * 31]).toBe(255)
  })
})
