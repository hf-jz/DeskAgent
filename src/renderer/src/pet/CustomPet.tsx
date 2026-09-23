import { useEffect, useRef, useState } from 'react'
import type { PetPose, PetMood } from './PetCharacter'
import { SPRITE_FRAME, SPRITE_COLS, SPRITE_ROW_INDEX, SPRITE_ROW_ORDER, SPRITE_FPS } from '../pet-customizer/spritesheet'

/**
 * CustomPet — photo-derived desktop pet, spritesheet player.
 *
 * The saved pet is a 5-row procedural spritesheet (see spritesheet.ts).
 * A rAF loop picks the row for the current pose/mood and cycles frames.
 * Extra life comes from:
 *   - head-tracking: rotates toward the cursor (main polls and pushes pet:mouse)
 *   - idle micro-actions: random wiggle / look-around between walks
 *   - CSS mood overlays (shake, breathe speed) on top of the canvas
 *   - sleep zzz
 */

interface CustomPetProps {
  /** file:// or data: URL of the spritesheet PNG */
  sheetUrl: string
  pose: PetPose
  mood: PetMood
  facing?: 'left' | 'right'
  /** cursor proximity from main-process polling */
  mouse?: { near: boolean; dx: number; dy: number }
}

type MicroAction = 'wiggle' | 'look' | null

const CUST_CSS = `
  .pet-cust { position: relative; width: 100%; height: 100%; pointer-events: none; }
  .pet-cust-flip { width: 100%; height: 100%; }
  .pet-cust.face-left .pet-cust-flip { transform: scaleX(-1); }
  .pet-cust .pet-cust-canvas { width: 100%; height: 100%; display: block; }
  /* head-tracking: gentle turn toward the cursor */
  .pet-cust-mouse { width: 100%; height: 100%; transform-origin: 50% 90%; transition: transform 0.35s ease-out; }
  /* mood overlays */
  .pet-cust-mood { width: 100%; height: 100%; transform-origin: 50% 100%; }
  .pet-cust.mood-confused .pet-cust-mood, .pet-cust.mood-error .pet-cust-mood { animation: custShake 0.4s ease-in-out infinite; }
  /* micro-actions (one-shot, re-triggered via key) */
  .pet-cust-micro.wiggle { animation: custWiggle 0.7s ease-in-out; }
  .pet-cust-micro.look { animation: custLook 1.6s ease-in-out; }
  /* sleep zzz */
  .pet-cust .pet-zzz { position: absolute; top: 2%; right: 8%; display: flex; flex-direction: column; align-items: center; opacity: 0; pointer-events: none; }
  .pet-cust.pose-sleep .pet-zzz { opacity: 1; }
  .pet-zzz span { font-size: 11px; font-weight: 700; color: var(--ink-muted, #9CA3AF); animation: custZzz 2.4s ease-in-out infinite; }
  .pet-zzz span:nth-child(2) { animation-delay: 0.6s; font-size: 9px; }
  .pet-zzz span:nth-child(3) { animation-delay: 1.2s; font-size: 7px; }
  @keyframes custWiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
  @keyframes custLook { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-9deg); } 75% { transform: rotate(9deg); } }
  @keyframes custShake { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
  @keyframes custZzz { 0% { transform: translateY(0); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
`

/** pose → spritesheet row; mood overrides (happy jumps, focus accelerates idle). */
function resolveRow(pose: PetPose, mood: PetMood): { row: number; fps: number } {
  if (mood === 'happy') return { row: SPRITE_ROW_INDEX.jump, fps: SPRITE_FPS.jump }
  if (mood === 'working' || mood === 'thinking' || mood === 'speaking') {
    return { row: SPRITE_ROW_INDEX.idle, fps: SPRITE_FPS.idle * 1.8 }
  }
  const row = pose === 'idle' ? 'idle' : pose === 'crawl' ? 'walk' : pose
  return { row: SPRITE_ROW_INDEX[row], fps: SPRITE_FPS[row] }
}

export default function CustomPet({ sheetUrl, pose, mood, facing = 'right', mouse }: CustomPetProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [micro, setMicro] = useState<{ action: MicroAction; key: number }>({ action: null, key: 0 })
  const frameStartRef = useRef(0)
  const rafRef = useRef(0)
  const moodRef = useRef(mood)
  const poseRef = useRef(pose)
  moodRef.current = mood
  poseRef.current = pose

  // load spritesheet image once per URL
  useEffect(() => {
    const img = new Image()
    imgRef.current = img
    img.src = sheetUrl
    return () => { imgRef.current = null }
  }, [sheetUrl])

  // animation loop — row by pose/mood, frame by elapsed time
  useEffect(() => {
    const tick = (now: number): void => {
      const canvas = canvasRef.current
      const img = imgRef.current
      if (!canvas || !img || !img.complete || img.naturalWidth === 0) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      if (frameStartRef.current === 0) frameStartRef.current = now
      const { row, fps } = resolveRow(poseRef.current, moodRef.current)
      const elapsed = (now - frameStartRef.current) / 1000
      const frame = Math.floor(elapsed * fps) % SPRITE_COLS
      const ctx = canvas.getContext('2d')!
      const sw = SPRITE_FRAME
      ctx.clearRect(0, 0, sw, sw)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(
        img,
        frame * SPRITE_FRAME, row * SPRITE_FRAME, SPRITE_FRAME, SPRITE_FRAME,
        0, 0, sw, sw,
      )
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafRef.current); frameStartRef.current = 0 }
  }, [sheetUrl])

  // idle micro-actions: random wiggle / look-around while nothing else is going on
  useEffect(() => {
    if (pose !== 'idle' || mood !== 'idle' || mouse?.near) return
    let timer = 0
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        const action: MicroAction = Math.random() < 0.5 ? 'wiggle' : 'look'
        setMicro((m) => ({ action, key: m.key + 1 }))
        schedule()
      }, 5000 + Math.random() * 8000)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [pose, mood, mouse?.near])

  // head-tracking transform: rotate toward the cursor, eased
  const near = mouse?.near === true
  const headTransform = near
    ? `rotate(${Math.max(-8, Math.min(8, (mouse.dx / 22))) }deg) translateX(${Math.max(-5, Math.min(5, mouse.dx / 60))}px)`
    : undefined

  return (
    <div className={`pet-cust pose-${pose} mood-${mood} face-${facing}`}>
      <style>{CUST_CSS}</style>
      <div className="pet-cust-flip">
        <div className="pet-cust-mouse" style={{ transform: headTransform }}>
          <div className="pet-cust-mood">
            <div
              key={micro.key}
              className={`pet-cust-micro ${micro.action ?? ''}`}
              onAnimationEnd={() => micro.action && setMicro((m) => ({ ...m, action: null }))}
            >
              <canvas ref={canvasRef} className="pet-cust-canvas" width={SPRITE_FRAME} height={SPRITE_FRAME} />
            </div>
          </div>
        </div>
      </div>
      <div className="pet-zzz" aria-hidden="true">
        <span>Z</span><span>z</span><span>z</span>
      </div>
    </div>
  )
}
