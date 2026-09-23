/**
 * Voice Bridge — manages voice.py subprocess lifecycle + sentence splitter for TTS.
 *
 * Singleton process, JSONL stdin/stdout protocol (same pattern as bridge.py).
 * ponytail: one process, one readline dispatcher, startPromise guard.
 */
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import { safeSend } from '../shared/ipc-main'

// ── resource path (same logic as desktop-agent.ts) ──
function resourcesDir(): string {
  const { app } = require('electron')
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
}

// ── Callbacks ──
export interface VoiceCallbacks {
  onAsrResult?: (text: string) => void
  onTtsDone?: (id: string, path: string) => void
  onTtsError?: (id: string, message: string) => void
  onError?: (message: string) => void
}

// ── Sentence boundary regex: CJK punctuation + newline ──
const SENTENCE_RE = /[。！？；\n]/

type VoiceState = 'idle' | 'starting' | 'ready' | 'error'

class VoiceBridge {
  private proc: ChildProcess | null = null
  private buffer = ''
  private state: VoiceState = 'idle'
  private pythonBin: string | null = null
  private startPromise: Promise<void> | null = null
  private cbs: VoiceCallbacks | null = null

  // ── Sentence splitter state ──
  private sentenceBuffer = ''
  private ttsCounter = 0
  private turnActive = false

  // ── Pending ASR requests (replaces the _origCbs callback-clobbering hack) ──
  private pendingAsr: { resolve: (text: string) => void; timer: NodeJS.Timeout } | null = null

  // ── Public API ──

  async start(): Promise<void> {
    if (this.state === 'ready') return
    if (this.startPromise) return this.startPromise
    if (this.state !== 'idle' && this.state !== 'error') return

    this.state = 'starting'
    this.startPromise = (async () => {
      this.pythonBin = await this.findPython()
      if (!this.pythonBin) {
        this.state = 'error'
        throw new Error('No Python runtime available for voice')
      }
      await this.spawnVoice()
    })()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  stop(): void {
    if (this.proc) {
      try { this.proc.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n') } catch {}
      try { this.proc.kill('SIGTERM') } catch {}
      this.proc = null
    }
    this.buffer = ''
    this.state = 'idle'
    this.cbs = null
    this.sentenceBuffer = ''
    this.turnActive = false
  }

  setCallbacks(cbs: VoiceCallbacks): void {
    this.cbs = cbs
  }

  isAlive(): boolean {
    return this.proc !== null && !this.proc.killed && this.proc.exitCode === null
  }

  async sendAsr(audioBase64: string): Promise<void> {
    await this.ensureReady()
    this.write({ cmd: 'asr', audio_b64: audioBase64 })
  }

  /** Request/response ASR with timeout — used by the voice:asr IPC handler. */
  async requestAsr(audioBase64: string, timeoutMs = 15_000): Promise<string> {
    if (this.pendingAsr) {
      // single-slot: cancel the stale waiter instead of clobbering callbacks
      clearTimeout(this.pendingAsr.timer)
      this.pendingAsr.resolve('')
      this.pendingAsr = null
    }
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAsr = null
        resolve('')
      }, timeoutMs)
      this.pendingAsr = { resolve, timer }
      this.sendAsr(audioBase64).catch(() => {
        clearTimeout(timer)
        if (this.pendingAsr?.resolve === resolve) this.pendingAsr = null
        resolve('')
      })
    })
  }

  async sendTts(text: string, id: string): Promise<void> {
    await this.ensureReady()
    this.write({ cmd: 'tts', text, id })
  }

  // ── Sentence splitter ──

  /** Feed a delta from agent output. Splits on sentence boundaries, fires TTS. */
  feedDelta(text: string): void {
    if (!text) return
    this.sentenceBuffer += text

    // Broadcast speaking state on first delta
    if (!this.turnActive) {
      this.turnActive = true
      this.broadcast('voice:speaking', true)
    }

    let m: RegExpExecArray | null
    SENTENCE_RE.lastIndex = 0
    while ((m = SENTENCE_RE.exec(this.sentenceBuffer)) !== null) {
      const boundary = m.index + 1
      const sentence = this.sentenceBuffer.slice(0, boundary).trim()
      this.sentenceBuffer = this.sentenceBuffer.slice(boundary)
      SENTENCE_RE.lastIndex = 0
      if (sentence.length > 1) {
        const id = `s${this.ttsCounter++}`
        this.sendTts(sentence, id).catch(() => {})
      }
    }
  }

  /** Flush remaining buffer at end of turn. */
  flushDelta(): void {
    const rest = this.sentenceBuffer.trim()
    this.sentenceBuffer = ''
    this.turnActive = false
    this.broadcast('voice:speaking', false)

    if (rest.length > 1) {
      const id = `s${this.ttsCounter++}`
      this.sendTts(rest, id).catch(() => {})
    }
  }

  /** Barge-in: clear sentence buffer, stop speaking state, stop pet playback. */
  interrupt(): void {
    this.sentenceBuffer = ''
    this.turnActive = false
    this.broadcast('voice:speaking', false)
    this.broadcast('voice:interrupt') // pet window clears its playback queue on this
  }

  // ── Broadcast helper ──

  private broadcast(channel: string, ...args: unknown[]): void {
    for (const w of BrowserWindow.getAllWindows()) {
      safeSend(w.webContents, channel, ...args)
    }
  }

  // ── Internals ──

  private write(data: Record<string, unknown>): void {
    this.proc?.stdin?.write(JSON.stringify(data) + '\n')
  }

  private async ensureReady(): Promise<void> {
    if (this.state !== 'ready') await this.start()
  }

  private async findPython(): Promise<string | null> {
    const candidates: string[] = []
    try {
      const { app } = require('electron')
      candidates.push(join(app.getPath('userData'), 'deskapp-agent-venv', 'bin', 'python3'))
    } catch {}
    candidates.push(join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'))
    candidates.push('/opt/homebrew/bin/python3')
    candidates.push('/usr/bin/python3')
    for (const p of candidates) {
      if (existsSync(p)) {
        console.log('[VoiceBridge] Found Python:', p)
        return p
      }
    }
    return null
  }

  private async spawnVoice(): Promise<void> {
    const voiceScript = join(resourcesDir(), 'voice.py')
    if (!existsSync(voiceScript)) {
      this.state = 'error'
      throw new Error('voice.py not found')
    }

    return new Promise((resolve, reject) => {
      this.buffer = ''

      const proc = spawn(this.pythonBin!, [voiceScript], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.proc = proc

      proc.stderr?.on('data', (d: Buffer) => {
        console.error('[VoiceBridge]', d.toString().trim())
      })

      proc.stdout?.on('data', (d: Buffer) => {
        if (this.proc !== proc) return
        this.buffer += d.toString()
        this.parseLines()
      })

      proc.on('exit', (code) => {
        console.log(`[VoiceBridge] exited (code ${code})`)
        if (this.proc !== proc) return
        this.proc = null
        this.state = 'idle'
        this.buffer = ''
      })

      proc.on('error', (err) => {
        console.error('[VoiceBridge] spawn error:', err.message)
        if (this.proc === proc) {
          this.proc = null
          this.state = 'error'
        }
        reject(err)
      })

      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM') } catch {}
        this.state = 'error'
        reject(new Error('Voice bridge start timeout (30s)'))
      }, 30_000)

      const check = setInterval(() => {
        if (this.state === 'ready') {
          clearTimeout(timeout)
          clearInterval(check)
          resolve()
        }
      }, 50)
    })
  }

  private parseLines(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        switch (ev.type) {
          case 'ready':
            this.state = 'ready'
            break
          case 'asr_final':
            if (this.pendingAsr) {
              clearTimeout(this.pendingAsr.timer)
              this.pendingAsr.resolve(ev.text || '')
              this.pendingAsr = null
            } else {
              this.cbs?.onAsrResult?.(ev.text || '')
            }
            if (ev.emotion) {
              this.broadcast('voice:emotion', ev.emotion)
            }
            break
          case 'tts_done':
            this.cbs?.onTtsDone?.(ev.id, ev.path)
            break
          case 'error':
            if (ev.id) {
              this.cbs?.onTtsError?.(ev.id, ev.message || '')
            } else {
              this.cbs?.onError?.(ev.message || '')
            }
            break
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

/** Singleton voice bridge */
export const voiceBridge = new VoiceBridge()
