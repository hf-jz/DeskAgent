/**
 * matting.ts — zero-dependency subject extraction for the custom pet flow.
 *
 * Pipeline: border flood-fill (background ≈ border colors within tolerance)
 * → largest connected component (the subject) → bbox/stats.
 * All functions operate on raw buffers (no canvas), so the core logic is
 * unit-testable in vitest; the canvas layer in PetCustomizerApp feeds
 * ImageData and applies the resulting mask.
 *
 * mask convention: 0 = background, 255 = foreground (subject).
 */

export interface MatteResult {
  /** Full-size mask, 0=bg 255=fg */
  mask: Uint8Array
  /** Foreground bounding box in pixels, null when nothing extracted */
  bbox: { x: number; y: number; w: number; h: number } | null
  /** Foreground pixel ratio over the whole image (0..1) */
  fgRatio: number
}

/**
 * Border flood-fill: any pixel connected to the image border whose color is
 * within `tolerance` of the border pixel it grew from is background.
 * Returns the background mask (255 = bg).
 */
export function floodFillBackground(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
): Uint8Array {
  const bg = new Uint8Array(w * h)
  if (w * h === 0) return bg
  const idx = (x: number, y: number): number => y * w + x
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h

  // Seed with every border pixel (transparent pixels are background outright).
  const stack: number[] = []
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const i = idx(x, y)
      if (rgba[i * 4 + 3] < 8) bg[i] = 255
      else stack.push(i)
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const i = idx(x, y)
      if (rgba[i * 4 + 3] < 8) bg[i] = 255
      else stack.push(i)
    }
  }

  const px = (i: number, c: number): number => rgba[i * 4 + c]
  const tol2 = tolerance * tolerance
  while (stack.length > 0) {
    const i = stack.pop()!
    if (bg[i] === 255) continue
    const x = i % w
    const y = (i / w) | 0
    const r = px(i, 0), g = px(i, 1), b = px(i, 2)
    bg[i] = 255
    // 4-neighbours; only grow where the pixel is opaque and close in color
    // to the pixel we grew from (tolerance² — squared euclidean on RG).
    // ponytail: single-pass Manhattan distance, sqrt-free via tolerance².
    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ]
    for (const [nx, ny] of neighbors) {
      if (!inBounds(nx, ny)) continue
      const ni = idx(nx, ny)
      if (bg[ni] === 255) continue
      if (rgba[ni * 4 + 3] < 8) { bg[ni] = 255; continue }
      const dr = px(ni, 0) - r, dg = px(ni, 1) - g, db = px(ni, 2) - b
      if (dr * dr + dg * dg + db * db <= tol2) stack.push(ni)
    }
  }
  return bg
}

/** All 4-connected components over a foreground mask, largest first. */
function components(fg: Uint8Array, w: number, h: number): { mask: Uint8Array; area: number }[] {
  const visited = new Uint8Array(w * h)
  const out: { mask: Uint8Array; area: number }[] = []
  const idx = (x: number, y: number): number => y * w + x
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h

  for (let i = 0; i < fg.length; i++) {
    if (fg[i] === 0 || visited[i] === 1) continue
    const mask = new Uint8Array(w * h)
    const queue = [i]
    visited[i] = 1
    let area = 0
    while (queue.length > 0) {
      const cur = queue.pop()!
      mask[cur] = 255
      area++
      const x = cur % w
      const y = (cur / w) | 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!inBounds(nx, ny)) continue
        const ni = idx(nx, ny)
        if (visited[ni] === 1 || fg[ni] === 0) continue
        visited[ni] = 1
        queue.push(ni)
      }
    }
    out.push({ mask, area })
  }
  out.sort((a, b) => b.area - a.area)
  return out
}

/** Keep the largest 4-connected component (original single-subject behavior). */
export function largestComponent(fg: Uint8Array, w: number, h: number): Uint8Array {
  const comps = components(fg, w, h)
  return comps.length > 0 ? comps[0].mask : new Uint8Array(w * h)
}

/**
 * Keep every component at least `minRatio` of the largest — rescues separated
 * parts of the subject (tail, ears, legs split by a background line).
 */
export function keepMajorComponents(fg: Uint8Array, w: number, h: number, minRatio = 0.15): Uint8Array {
  const comps = components(fg, w, h)
  const out = new Uint8Array(w * h)
  if (comps.length === 0) return out
  const cutoff = comps[0].area * minRatio
  for (const c of comps) {
    if (c.area < cutoff) break
    for (let i = 0; i < out.length; i++) if (c.mask[i] === 255) out[i] = 255
  }
  return out
}

/** Fill holes inside the foreground: background pixels not connected to the
 *  image border become foreground (subject-internal gaps, e.g. between legs). */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice()
  const edgeBg = new Uint8Array(w * h)
  const stack: number[] = []
  const idx = (x: number, y: number): number => y * w + x
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) {
    const i = idx(x, y)
    if (mask[i] === 0) { edgeBg[i] = 1; stack.push(i) }
  }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) {
    const i = idx(x, y)
    if (mask[i] === 0) { edgeBg[i] = 1; stack.push(i) }
  }
  while (stack.length > 0) {
    const cur = stack.pop()!
    const x = cur % w
    const y = (cur / w) | 0
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (!inBounds(nx, ny)) continue
      const ni = idx(nx, ny)
      if (mask[ni] === 255 || edgeBg[ni] === 1) continue
      edgeBg[ni] = 1
      stack.push(ni)
    }
  }
  // background pixels NOT reached from the border are holes → foreground
  for (let i = 0; i < out.length; i++) {
    if (mask[i] === 0 && edgeBg[i] === 0) out[i] = 255
  }
  return out
}

/** Dilate the foreground by r px (recover anti-aliased / fur edge pixels). */
export function dilate(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  if (r <= 0) return mask.slice()
  const out = mask.slice()
  const r2 = r * r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 255) continue
      // any foreground pixel within r²? (cheap square scan)
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
      outer:
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - x, dy = yy - y
          if (dx * dx + dy * dy <= r2 && mask[yy * w + xx] === 255) {
            out[y * w + x] = 255
            break outer
          }
        }
      }
    }
  }
  return out
}

/**
 * Full auto-matte pipeline: border flood-fill → keep major components →
 * fill holes → dilate 1px. Handles real photos better than the plain
 * largest-component version (gradient/patterned backgrounds, split parts).
 */
export function autoMatte(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
): MatteResult {
  const bg = floodFillBackground(rgba, w, h, tolerance)
  const fg = new Uint8Array(w * h)
  for (let i = 0; i < bg.length; i++) fg[i] = bg[i] === 255 ? 0 : 255
  const major = keepMajorComponents(fg, w, h, 0.15)
  const mask = dilate(fillHoles(major, w, h), w, h, 1)
  const bbox = computeBBox(mask, w, h)
  let count = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] === 255) count++
  return { mask, bbox, fgRatio: count / mask.length }
}

/**
 * Automatic tolerance: run the pipeline over a candidate ladder and pick the
 * tolerance whose foreground ratio lands in [0.12, 0.85] with the largest
 * foreground (most inclusive), falling back to the ratio closest to 0.35.
 * This is the "recognize the subject" heuristic — pure and deterministic.
 */
export function pickTolerance(rgba: Uint8ClampedArray, w: number, h: number): number {
  const LADDER = [16, 24, 32, 40, 50, 62, 74]
  let best = LADDER[0]
  let bestScore = -Infinity
  let fallback = LADDER[0]
  let fallbackScore = Infinity
  for (const t of LADDER) {
    const res = autoMatte(rgba, w, h, t)
    if (res.bbox === null) continue
    const r = res.fgRatio
    if (r >= 0.12 && r <= 0.85) {
      const score = r // prefer largest inclusive extraction
      if (score > bestScore) { bestScore = score; best = t }
    }
    const fScore = Math.abs(r - 0.35)
    if (fScore < fallbackScore) { fallbackScore = fScore; fallback = t }
  }
  return bestScore === -Infinity ? fallback : best
}

/** Bounding box of non-zero mask pixels, or null when empty. */
export function computeBBox(
  mask: Uint8Array,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 255) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Paint a circular brush on a mask — erase (mark background) or restore
 * (mark foreground). In-place, mutates `mask`.
 */
export function paintBrush(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  mode: 'erase' | 'restore',
): void {
  const value = mode === 'erase' ? 0 : 255
  const r2 = r * r
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r2) mask[y * w + x] = value
    }
  }
}

/**
 * Posterize (cartoon-ish): quantize each RGB channel to `levels` steps and
 * boost saturation by `sat` (0..1). In-place on rgba; alpha untouched.
 */
export function posterize(
  rgba: Uint8ClampedArray,
  levels: number,
  sat: number,
): void {
  const step = 255 / levels
  for (let i = 0; i < rgba.length; i += 4) {
    let r = Math.round(rgba[i] / step) * step
    let g = Math.round(rgba[i + 1] / step) * step
    let b = Math.round(rgba[i + 2] / step) * step
    // saturation boost in RGB space: push toward the channel mean
    const m = (r + g + b) / 3
    r = m + (r - m) * (1 + sat)
    g = m + (g - m) * (1 + sat)
    b = m + (b - m) * (1 + sat)
    rgba[i] = Math.max(0, Math.min(255, r))
    rgba[i + 1] = Math.max(0, Math.min(255, g))
    rgba[i + 2] = Math.max(0, Math.min(255, b))
  }
}
