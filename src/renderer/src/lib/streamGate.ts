// ── StreamGate — Three-state streaming gate (P0-7) ──
//
// Direct port of openworker's streamGate.ts (gui/src/streamGate.ts, 41 lines).
// Prevents layout thrashing during streaming by holding the assistant message
// until enough content has arrived.
//
// State machine:
//   idle → (turn starts, < word threshold → hold) → hold
//   idle → (turn starts, ≥ word threshold → streaming) → streaming
//   hold → (≥ threshold OR elapsed ≥ time threshold → streaming) → streaming
//   streaming → (turn.end → settled) → settled
//   settled → (next turn.start → idle) → idle

// ── Config (tunable per component) ──

export interface StreamGateConfig {
  /** How many words before promoting from hold to streaming (default: 20) */
  wordThreshold: number
  /** Max milliseconds to wait before forcing streaming out of hold (default: 200) */
  holdMs: number
}

const DEFAULT_CONFIG: StreamGateConfig = { wordThreshold: 20, holdMs: 200 }

// ── State ──

export type StreamGateState = 'idle' | 'hold' | 'streaming' | 'settled'

export interface StreamGateInstance {
  state: StreamGateState
  /** Call on each turn.start to transition into hold */
  onTurnStart: () => void
  /** Call on each text delta. Returns the effective state after this delta. */
  onDelta: (totalText: string) => StreamGateState
  /** Call on turn.end/turn.interrupted/turn.error to settle */
  onTurnEnd: () => void
  /** Reset to idle */
  reset: () => void
}

// ── Factory ──

export function createStreamGate(config?: Partial<StreamGateConfig>): StreamGateInstance {
  const cfg: StreamGateConfig = { ...DEFAULT_CONFIG, ...config }
  let state: StreamGateState = 'idle'
  let holdStart: number = 0
  let wordCount: number = 0

  function countWords(text: string): number {
    const trimmed = text.trim()
    if (!trimmed) return 0
    // CJK + English word count: count CJK chars + Latin word segments
    let words = 0
    let inWord = false
    for (const ch of trimmed) {
      if (ch === ' ' || ch === '\n') {
        if (inWord) { words++; inWord = false }
      } else {
        if (!inWord) { words++; inWord = true }
        // CJK chars are individual words
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) { words++; inWord = false }
      }
    }
    if (inWord) words++
    return words
  }

  function shouldPromote(totalText: string): boolean {
    wordCount = countWords(totalText)
    if (wordCount >= cfg.wordThreshold) return true
    if (Date.now() - holdStart >= cfg.holdMs) return true
    return false
  }

  return {
    get state() { return state },

    onTurnStart: () => {
      state = 'hold'
      holdStart = Date.now()
      wordCount = 0
    },

    onDelta: (totalText: string): StreamGateState => {
      if (state === 'streaming' || state === 'settled') return state
      if (state === 'hold' && shouldPromote(totalText)) {
        state = 'streaming'
      }
      return state
    },

    onTurnEnd: () => {
      state = 'settled'
    },

    reset: () => {
      state = 'idle'
      holdStart = 0
      wordCount = 0
    },
  }
}
