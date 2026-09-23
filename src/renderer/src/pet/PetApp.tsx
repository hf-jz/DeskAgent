import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { t } from '../lib/i18n'
import PetCharacter, { PetPose, PetMood } from './PetCharacter'
import SpeechBubble from './SpeechBubble'

/**
 * Pet window root — the pet IS the interface.
 *
 * On launch only the pet appears (no bubble window). It breathes, greets
 * via its own speech bubble, then lives autonomously: it walks across the
 * desktop (window slides while it paddles), lies down, sleeps, and speaks
 * up when something matters — setup missing, task done, task error — plus
 * an occasional idle tip every few minutes.
 *
 * Four appearance styles (Settings → Appearance):
 *  - mochi / bobo : SVG character pets with the autonomous behavior loop.
 *  - strands / rings : classic WebGL orb animations (lazy-loaded).
 *
 * Agent activity overrides the pose: working = alert fast breathing,
 * error = brief shake, then back to the loop.
 */

// Keep in sync with PET_BUBBLE_SPACE in src/main/pet-window.ts — the main
// process sizes the window as (body + bubble space), the renderer recovers
// the square body size from the window height.
const BUBBLE_SPACE = 92

const GREETING_DELAY_MS = 500

const IDLE_CHATTER_KEYS = ['pet.chatter.click', 'pet.chatter.edge', 'pet.chatter.summon', 'pet.chatter.here']

type PetStyle = 'mochi' | 'bobo' | 'strands' | 'rings' | 'nukey' | 'boba' | 'boxcat' | 'punchy' | 'scoop'
type Facing = 'left' | 'right'

const STRAND_COLORS = ['#7C3AED', '#A78BFA', '#06B6D4', '#EAB308']

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

// Lazy-load WebGL animation components — only fetched when a WebGL style
// is actually selected (~750KB of OGL/Three.js stays out of the main path).
const StrandsAnimation = lazy(() => import('./StrandsAnimation'))
const MagicRingsAnimation = lazy(() => import('./MagicRingsAnimation'))

/** Loading placeholder while a WebGL component loads (also the no-WebGL fallback orb) */
function OrbFallback({ label, pulsing }: { label: string; pulsing: boolean }): React.JSX.Element {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'radial-gradient(circle at 40% 40%, #A78BFA 0%, #7C3AED 30%, #06B6D4 70%, #0891B2 100%)',
      borderRadius: '50%', pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', top: '12%', left: '20%',
        width: '30%', height: '20%', borderRadius: '50%',
        background: 'rgba(255,255,255,0.2)', transform: 'rotate(-20deg)',
      }} />
      <div style={{
        fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.7)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        animation: pulsing ? 'petOrbPulse 0.8s ease-in-out infinite' : 'petOrbBreathe 4s ease-in-out infinite',
      }}>
        {label}
      </div>
      <style>{`
        @keyframes petOrbBreathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes petOrbPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
      `}</style>
    </div>
  )
}

export default function PetApp(): React.JSX.Element {
  const [petStyle, setPetStyle] = useState<PetStyle>('strands')
  const [opacity, setOpacity] = useState(85)
  const [pose, setPose] = useState<PetPose>('idle')
  const [mood, setMood] = useState<PetMood>('idle')
  const [facing, setFacing] = useState<Facing>('right')
  const [mouse, setMouse] = useState<{ near: boolean; dx: number; dy: number } | undefined>()
  useEffect(() => window.deskAppAPI.onPetMouse?.((m) => setMouse(m)), [])
  const [bubble, setBubble] = useState<string | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [mouthOpen, setMouthOpen] = useState(1)  // 0.2→2.5, driven by AnalyserNode

  const bubbleHideTimer = useRef(0)
  const lastSayAt = useRef(0)

  // ── TTS audio player + AnalyserNode mouth drive ──
  const ttsQueueRef = useRef<string[]>([])
  const ttsPlayingRef = useRef(false)
  const analyserRef = useRef<{ node: AnalyserNode; ctx: AudioContext; timer: number } | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  const stopAnalyser = () => {
    const a = analyserRef.current
    if (a) { clearInterval(a.timer); a.ctx.close().catch(() => {}); analyserRef.current = null }
    setMouthOpen(1)
  }

  const startAnalyser = (audio: HTMLAudioElement) => {
    stopAnalyser()
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaElementSource(audio)
      const node = ctx.createAnalyser()
      node.fftSize = 256
      src.connect(node)
      node.connect(ctx.destination)
      const data = new Uint8Array(node.fftSize)
      const timer = window.setInterval(() => {
        node.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / data.length)
        // Map RMS 0.01→0.3 to mouth 0.5→2.0 (exponential smoothing: fast attack, slow release)
        const target = 0.5 + Math.min(1.5, rms * 5)
        setMouthOpen(prev => prev + (target - prev) * (target > prev ? 0.4 : 0.15))
      }, 66)  // ~15Hz
      analyserRef.current = { node, ctx, timer }
    } catch { /* MediaElementSource may fail if already connected */ }
  }

  const playNextTts = () => {
    if (ttsPlayingRef.current) return
    const queue = ttsQueueRef.current
    if (queue.length === 0) { stopAnalyser(); return }
    ttsPlayingRef.current = true
    const path = queue.shift()!
    const a = new Audio(`file://${path}`)
    currentAudioRef.current = a
    startAnalyser(a)
    a.onended = () => { currentAudioRef.current = null; ttsPlayingRef.current = false; playNextTts() }
    a.onerror = () => { currentAudioRef.current = null; ttsPlayingRef.current = false; stopAnalyser(); playNextTts() }
    a.play().catch(() => { currentAudioRef.current = null; ttsPlayingRef.current = false; stopAnalyser(); playNextTts() })
  }

  // Barge-in: main cleared its sentence buffer — stop local playback too
  useEffect(() => {
    return window.deskAppAPI.onVoiceInterrupt(() => {
      ttsQueueRef.current = []
      ttsPlayingRef.current = false
      currentAudioRef.current?.pause()
      currentAudioRef.current = null
      stopAnalyser()
    })
  }, [])

  const CHARACTER_STYLES = ['mochi', 'bobo', 'nukey', 'boba', 'boxcat', 'punchy', 'scoop'] as const
  const isCharacter = (CHARACTER_STYLES as readonly string[]).includes(petStyle)

  /** Pet speaks. Overwrites any current bubble; records time so idle chatter won't stomp it. */
  const say = (text: string, ms = 5000): void => {
    window.clearTimeout(bubbleHideTimer.current)
    setBubble(text)
    lastSayAt.current = Date.now()
    bubbleHideTimer.current = window.setTimeout(() => setBubble(null), ms)
  }

  // Settings: initial load + live updates (event-driven, no polling)
  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      setPetStyle(s.petStyle || 'strands')
      setOpacity(s.opacity || 85)
    }).catch(() => {})

    const unsub = window.deskAppAPI.onSettingsChanged((s) => {
      setPetStyle(s.petStyle || 'strands')
      setOpacity(s.opacity || 85)
    })

    const unsubChunk = window.deskAppAPI.onTaskChunk(() => setMood('working'))
    const unsubDone = window.deskAppAPI.onTaskDone(() => {
      setMood('happy')
      say(t('pet.taskDone'), 5000)
      setTimeout(() => setMood('idle'), 2000)
    })
    const unsubError = window.deskAppAPI.onTaskError(() => {
      setMood('confused')
      say(t('pet.taskError'), 6000)
      setTimeout(() => setMood('idle'), 3000)
    })

    // ── Voice event listeners ──
    const unsubTts = window.deskAppAPI.onVoiceTtsReady((_id, path) => {
      ttsQueueRef.current.push(path)
      playNextTts()
    })
    const unsubSpeaking = window.deskAppAPI.onVoiceSpeaking?.((active) => {
      if (active) setMood('speaking')
      else {
        // ponytail: speaking → idle, don't clobber if already in a special mood
        setMood((m) => (m === 'speaking' ? 'idle' : m))
        ttsQueueRef.current.length = 0
        ttsPlayingRef.current = false
        stopAnalyser()
      }
    }) || (() => {})
    const unsubEmotion = window.deskAppAPI.onVoiceEmotion?.((emotion) => {
      // ponytail: empathy — mirror user's emotion briefly, then return
      const moodMap: Record<string, PetMood> = { happy: 'happy', sad: 'confused', angry: 'confused', surprised: 'happy' }
      const m = moodMap[emotion] || 'idle'
      if (m !== 'idle') { setMood(m); setTimeout(() => setMood('idle'), 3000) }
    }) || (() => {})

    // P0-5: inbox badge — initial count + live push
    window.deskAppAPI.getInboxCount?.().then(setInboxCount).catch(() => {})
    const unsubInbox = window.deskAppAPI.onInboxChanged?.((c) => setInboxCount(c)) || (() => {})

    return () => {
      unsub()
      unsubChunk(); unsubDone(); unsubError()
      unsubInbox()
      unsubTts(); unsubSpeaking(); unsubEmotion()
      stopAnalyser()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // WebGL detection — only matters for strands/rings styles
  useEffect(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) setWebglFailed(true)
    const timer = setTimeout(() => {
      const c2 = document.createElement('canvas')
      const gl2 = c2.getContext('webgl') || c2.getContext('experimental-webgl')
      setWebglFailed(!gl2)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // L0 greeting: pet speaks first, before any configuration. If the LLM key
  // is missing, follow up with a setup hint instead of popping a window.
  useEffect(() => {
    const showTimer = setTimeout(() => {
      say(t('pet.greeting'), 6000)
      window.deskAppAPI.getOnboardingState().then((st) => {
        if (st.needsSetup) {
          setTimeout(() => say(t('pet.setupHint'), 8000), 8000)
        }
      }).catch(() => {})
    }, GREETING_DELAY_MS)
    return () => clearTimeout(showTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Idle chatter — a gentle tip every few minutes, never stomping real messages
  useEffect(() => {
    if (!isCharacter) return
    let timer = 0
    let i = Math.floor(Math.random() * IDLE_CHATTER_KEYS.length)
    const tick = (): void => {
      if (Date.now() - lastSayAt.current > 15000) {
        say(t(IDLE_CHATTER_KEYS[i % IDLE_CHATTER_KEYS.length]), 5000)
        i++
      }
      timer = window.setTimeout(tick, rand(240000, 480000))
    }
    timer = window.setTimeout(tick, rand(180000, 300000))
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCharacter])

  // Autonomous behavior loop — character pets only, paused while agent works.
  // idle → walk (window slides!) | lie → sleep → idle ...
  useEffect(() => {
    if (!isCharacter || mood !== 'idle') {
      setPose('idle')
      return
    }
    let cancelled = false
    let timer = 0
    const wait = (ms: number): Promise<void> => new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms)
    })

    const pickWalkDirection = async (): Promise<Facing> => {
      let dir: Facing = Math.random() < 0.5 ? 'left' : 'right'
      try {
        const b = await window.deskAppAPI.getPetBounds()
        if (b) {
          const scr = window.screen
          const availRight = scr.availLeft + scr.availWidth
          if (b.x + b.width + 380 > availRight) dir = 'left'
          else if (b.x < scr.availLeft + 380) dir = 'right'
        }
      } catch { /* bounds unavailable — keep random dir */ }
      return dir
    }

    const run = async (): Promise<void> => {
      let current: PetPose = 'idle'
      while (!cancelled) {
        if (current === 'idle') {
          await wait(rand(4000, 9000))
          if (cancelled) break
          const r = Math.random()
          if (r < 0.45) {
            // Walk: window slides horizontally while the pet paddles
            const dir = await pickWalkDirection()
            const dist = Math.round(rand(160, 380))
            const dx = dir === 'left' ? -dist : dist
            const duration = Math.round(dist / 0.055) // ~55 px/s
            setFacing(dir)
            setPose('crawl')
            let actual = dx
            try { actual = await window.deskAppAPI.walkPet(dx, duration) } catch { /* walk unsupported */ }
            if (cancelled) break
            if (actual !== 0) {
              await wait(Math.round(duration * Math.abs(actual / dist)))
              if (cancelled) break
            }
            setPose('idle')
          } else if (r < 0.70) {
            setPose('lie')
            current = 'lie'
          }
          // else: keep idling
        } else if (current === 'lie') {
          await wait(rand(7000, 13000))
          if (cancelled) break
          if (Math.random() < 0.6) {
            setPose('sleep')
            current = 'sleep'
          } else {
            setPose('idle')
            current = 'idle'
          }
        } else {
          // sleep
          await wait(rand(14000, 24000))
          if (cancelled) break
          setPose('idle')
          current = 'idle'
        }
      }
    }
    run()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [mood, isCharacter])

  // The pet body is the bottom square of the window; the strip above is
  // reserved for the speech bubble.
  const bodySize = Math.max(60, window.innerHeight - BUBBLE_SPACE)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
      <SpeechBubble text={bubble} />
      <div style={{
        position: 'absolute', left: '50%', bottom: 0,
        transform: 'translateX(-50%)',
        width: bodySize, height: bodySize,
        opacity: opacity / 100,
        borderRadius: isCharacter ? 0 : '50%',
        overflow: 'hidden',
      }}>
        {isCharacter ? (
          <PetCharacter species={petStyle} pose={pose} mood={mood} facing={facing} mouthOpen={mouthOpen} mouse={mouse} />
        ) : webglFailed ? (
          <OrbFallback label={mood === 'speaking' ? '🎤' : mood === 'working' || mood === 'thinking' ? '⚡' : mood === 'confused' || mood === 'error' ? '?' : mood === 'happy' ? '✨' : 'AI'} pulsing={mood === 'working' || mood === 'thinking' || mood === 'speaking'} />
        ) : (
          <Suspense fallback={<OrbFallback label="" pulsing={false} />}>
            {petStyle === 'strands' ? (
              <StrandsAnimation
                colors={mood === 'confused' || mood === 'error' ? ['#EF4444', '#F87171', '#FCA5A5'] : mood === 'happy' ? ['#FBBF24', '#F59E0B', '#FDE68A'] : STRAND_COLORS}
                count={3}
                speed={mood === 'confused' || mood === 'error' ? 1.5 : mood === 'speaking' || mood === 'working' || mood === 'thinking' ? 1.0 : 0.3}
                amplitude={0.7}
                glow={mood === 'confused' || mood === 'error' ? 3.0 : mood === 'happy' ? 2.8 : 2.2}
                opacity={1}
              />
            ) : (
              <MagicRingsAnimation
                color={mood === 'confused' || mood === 'error' ? '#EF4444' : STRAND_COLORS[0]} colorTwo={STRAND_COLORS[2]}
                speed={mood === 'speaking' || mood === 'working' || mood === 'thinking' ? 1.2 : 0.8}
                ringCount={mood === 'speaking' || mood === 'working' || mood === 'thinking' ? 8 : 5}
                opacity={0.95}
                clickBurst={false}
              />
            )}
          </Suspense>
        )}
      </div>
      {/* P0-5: inbox badge — red dot with open-item count on the pet's head */}
      {inboxCount > 0 && (
        <div style={{
          position: 'absolute',
          left: `calc(50% + ${bodySize / 2 - 18}px)`,
          bottom: bodySize - 14,
          minWidth: '18px', height: '18px',
          borderRadius: '9px',
          background: '#EF4444',
          border: '2px solid rgba(255,255,255,0.9)',
          color: '#fff', fontSize: '11px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
          pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}>
          {inboxCount > 99 ? '99+' : inboxCount}
        </div>
      )}
    </div>
  )
}
