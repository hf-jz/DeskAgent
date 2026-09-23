// ── D3 #41A: voice input via Web Speech API (Chromium built-in) ──
// Four-state machine: idle → listening → transcribing → draft inserted.
// Zero IPC: recognition runs in the renderer; the caller gets text callbacks.
// Degrades to `supported=false` (greyed button) when the API or permission
// is unavailable.
import { useEffect, useRef, useState } from 'react'

export type SpeechState = 'idle' | 'listening' | 'transcribing'

interface SpeechHook {
  supported: boolean
  state: SpeechState
  /** 0..1 live mic level while listening (for the waveform bars) */
  level: number
  toggle: () => void
}

export function useSpeechInput(onText: (text: string, isFinal: boolean) => void): SpeechHook {
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState<SpeechState>('idle')
  const [level, setLevel] = useState(0)
  const recRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<{ ctx: AudioContext; raf: number } | null>(null)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
    return () => { cleanup() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cleanup = (): void => {
    try { recRef.current?.stop() } catch { /* not running */ }
    recRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (audioRef.current) {
      cancelAnimationFrame(audioRef.current.raf)
      audioRef.current.ctx.close().catch(() => {})
      audioRef.current = null
    }
    setLevel(0)
  }

  const startLevelMeter = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        // RMS ~60Hz (fine for a pulse bar; coworker uses ~10Hz)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3))
        audioRef.current!.raf = requestAnimationFrame(tick)
      }
      audioRef.current = { ctx, raf: requestAnimationFrame(tick) }
    } catch { /* meter is decorative — recognition still works */ }
  }

  const toggle = (): void => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return

    if (recRef.current) {
      // listening → transcribing (recognition flushes its final result)
      setState('transcribing')
      try { recRef.current.stop() } catch { /* already stopped */ }
      return
    }

    const rec = new SR()
    rec.lang = 'zh-CN'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e: any): void => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) onText(r[0].transcript.trim(), true)
        else interim += r[0].transcript
      }
      if (interim) onText(interim, false) // draft state: live text in the composer
    }
    rec.onend = (): void => { cleanup(); setState('idle') }
    rec.onerror = (): void => { cleanup(); setState('idle') }

    recRef.current = rec
    setState('listening')
    startLevelMeter()
    try { rec.start() } catch { cleanup(); setState('idle') }
  }

  return { supported, state, level, toggle }
}
