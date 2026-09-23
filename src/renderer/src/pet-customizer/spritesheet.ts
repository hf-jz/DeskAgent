/**
 * spritesheet.ts — procedural multi-frame animation for photo pets.
 *
 * The user's photo is a single frame, so the spritesheet is synthesized from
 * geometric transforms (petdex-style sheet: rows = states, cols = frames):
 *
 *   row 0 idle   (6 frames) — breathing scale + gentle float
 *   row 1 walk   (8 frames) — bounce + tilt (body stretch/compress)
 *   row 2 lie    (4 frames) — flattened slow breath
 *   row 3 sleep  (4 frames) — flattened, dimmed
 *   row 4 jump   (5 frames) — leap: anticipation → lift → stretch → land
 *
 * Frame geometry constants mirror src/shared/ipc-channels.ts.
 */

export const SPRITE_FRAME = 128
export const SPRITE_COLS = 8
export const SPRITE_ROWS = 5

export type SpriteRow = 'idle' | 'walk' | 'lie' | 'sleep' | 'jump'

export const SPRITE_ROW_ORDER: SpriteRow[] = ['idle', 'walk', 'lie', 'sleep', 'jump']
export const SPRITE_ROW_INDEX: Record<SpriteRow, number> = {
  idle: 0, walk: 1, lie: 2, sleep: 3, jump: 4,
}

export interface FrameSpec {
  /** vertical offset as a fraction of frame height (-0.35..0.05) */
  ty: number
  /** tilt in degrees (-8..8) */
  rot: number
  /** vertical squash/stretch (0.75..1.1) */
  sy: number
  /** optional dimming for sleep frames */
  dim?: number
}

const TAU = Math.PI * 2

/** Idle: 6-frame breathing cycle, scaleY 0.97↔1.03 + gentle float. */
export function genBreath(n: number): FrameSpec[] {
  const out: FrameSpec[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    const s = Math.sin(t * TAU)
    out.push({ ty: -s * 0.012, rot: 0, sy: 1 + s * 0.03 })
  }
  return out
}

/** Walk: 8-frame hop — up at frame 2, down at frame 6, tilt ±4°, squash on land. */
export function genWalk(n: number): FrameSpec[] {
  const out: FrameSpec[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    const s = Math.sin(t * TAU)
    const ty = -Math.max(0, s) * 0.09
    const rot = s * 4
    // stretch mid-air, squash on contact
    const sy = s > 0.2 ? 1.05 : 0.92
    out.push({ ty, rot, sy })
  }
  return out
}

/** Lie: flattened slow breath, 4 frames. */
export function genLie(n: number): FrameSpec[] {
  const out: FrameSpec[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    out.push({ ty: 0, rot: 0, sy: 0.8 + Math.sin(t * TAU) * 0.02 })
  }
  return out
}

/** Sleep: flattened, dimmed, very slow. */
export function genSleep(n: number): FrameSpec[] {
  const out: FrameSpec[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    out.push({ ty: 0, rot: 0, sy: 0.78 + Math.sin(t * TAU) * 0.015, dim: 0.72 })
  }
  return out
}

/** Jump: anticipation squash → lift → stretched peak → land. */
export function genJump(n: number): FrameSpec[] {
  const out: FrameSpec[] = []
  const peak = Math.max(1, n - 1)
  for (let i = 0; i < n; i++) {
    const t = i / peak
    // parabolic height
    const h = 4 * t * (1 - t)
    const ty = -h * 0.3
    const rising = t < 0.5
    const sy = rising ? 1 + (0.5 - t) * 0.14 : 0.95 + (t - 0.5) * 0.14
    out.push({ ty, rot: rising ? -4 : 4, sy })
  }
  return out
}

/** Frame tables per row. Pure data — unit-tested. */
export const FRAMES: Record<SpriteRow, FrameSpec[]> = {
  idle: genBreath(6),
  walk: genWalk(8),
  lie: genLie(4),
  sleep: genSleep(4),
  jump: genJump(5),
}

export const SPRITE_FPS: Record<SpriteRow, number> = {
  idle: 7, walk: 12, lie: 5, sleep: 3, jump: 12,
}

/** Subject placement inside a frame — pure math, unit-tested. */
export function getSubjectFit(
  subjectW: number,
  subjectH: number,
  frame = SPRITE_FRAME,
  maxFill = 0.82,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(1, (frame * maxFill) / Math.max(subjectW, subjectH))
  const w = subjectW * scale
  const h = subjectH * scale
  return { x: (frame - w) / 2, y: frame - h, w, h }
}

/**
 * Compose the 5-row spritesheet from a transparent subject canvas
 * (already background-masked, cropped to the subject bbox).
 * Returns a canvas of SPRITE_COLS×FRAME by SPRITE_ROWS×FRAME.
 */
export function buildSpritesheet(subject: HTMLCanvasElement): HTMLCanvasElement {
  const sheet = document.createElement('canvas')
  sheet.width = SPRITE_COLS * SPRITE_FRAME
  sheet.height = SPRITE_ROWS * SPRITE_FRAME
  const ctx = sheet.getContext('2d')!
  const fit = getSubjectFit(subject.width, subject.height)

  for (const [rowIdx, row] of SPRITE_ROW_ORDER.entries()) {
    const specs = FRAMES[row]
    for (let col = 0; col < SPRITE_COLS; col++) {
      const spec = specs[col % specs.length]
      const ox = col * SPRITE_FRAME
      const oy = rowIdx * SPRITE_FRAME
      ctx.save()
      // transform around the frame's bottom-center
      ctx.translate(ox + SPRITE_FRAME / 2, oy + SPRITE_FRAME)
      ctx.rotate((spec.rot * Math.PI) / 180)
      ctx.scale(1, spec.sy)
      ctx.translate(-(ox + SPRITE_FRAME / 2), -(oy + SPRITE_FRAME))
      ctx.translate(0, spec.ty * SPRITE_FRAME)
      if (spec.dim !== undefined) ctx.filter = `brightness(${spec.dim})`
      ctx.drawImage(subject, ox + fit.x, oy + fit.y, fit.w, fit.h)
      ctx.restore()
    }
  }
  return sheet
}
