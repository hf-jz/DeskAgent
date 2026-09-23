/**
 * img2threejs-parser.ts — pure parser for the forge state machine output.
 * No Electron imports → unit-testable (see tests/img2threejs.test.ts).
 *
 * forge emits two line formats (identical shape):
 *   LOCAL_STATE status=active step=image-analysis pass=none loop=0/3 total=0/6
 *   STATE status=active step=image-analysis pass=none loop=0/3 total=0/6
 * plus optional "STOP: <reason>" / "next command: <cmd>" lines and a
 * "pending mandatory steps:" block.
 */

export interface ForgeStepState {
  status: string
  currentStep: string
  currentPass: string | null
  loopPass: number
  loopMax: number
  total: number
  totalMax: number
  stopReason?: string
  nextCommand?: string
  pending: string[]
}

const STATE_RE = /^(?:LOCAL_STATE|STATE) status=(\S+) step=(\S+) pass=(\S+) loop=(\d+)\/(\d+) total=(\d+)\/(\d+)$/

/** Parse forge/next.py or forge/state.py stdout into structured state. */
export function parseForgeOutput(out: string): ForgeStepState {
  const state: ForgeStepState = {
    status: 'unknown',
    currentStep: '',
    currentPass: null,
    loopPass: 0,
    loopMax: 0,
    total: 0,
    totalMax: 0,
    pending: [],
  }
  let inPending = false
  for (const rawLine of out.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const m = STATE_RE.exec(line)
    if (m) {
      state.status = m[1]
      state.currentStep = m[2]
      state.currentPass = m[3] === 'none' ? null : m[3]
      state.loopPass = Number(m[4])
      state.loopMax = Number(m[5])
      state.total = Number(m[6])
      state.totalMax = Number(m[7])
      continue
    }
    if (line.startsWith('STOP:')) {
      state.stopReason = line.slice(5).trim()
      continue
    }
    if (line.startsWith('next command:')) {
      state.nextCommand = line.slice('next command:'.length).trim()
      continue
    }
    if (line === 'pending mandatory steps:') {
      inPending = true
      continue
    }
    if (inPending) {
      if (line.startsWith('- ')) {
        state.pending.push(line.slice(2).trim())
        continue
      }
      if (state.pending.length > 0) inPending = false
    }
  }
  return state
}

/** Exit code 3 from next.py means the pipeline stopped. */
export function isStopped(state: ForgeStepState): boolean {
  return state.status === 'stopped' || state.stopReason !== undefined
}
