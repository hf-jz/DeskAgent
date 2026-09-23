// ── bridge.py stdio protocol: versioning + frame parsing ──
//
// The bridge speaks JSONL over stdout. Before this module the frames were
// parsed with a bare `JSON.parse` inside BridgeManager.parseLines, so a stale
// main process silently mis-read a newer bridge's frames (dropped fields, no
// signal). Shape borrowed from google/ax's harness protocol: every frame is
// versioned, unknown versions are rejected loudly instead of half-parsed, and
// errors carry a machine-readable code (see docs/ax/02-deleted-era.md §3.1-3.2).
//
// Pure module — no electron, no fs — so the contract is unit-testable.

/** Bump when a frame's meaning changes; the bridge injects this on every emit. */
export const PROTOCOL_VERSION = 1

/** Machine-readable failure classes, mirrored by bridge.py's error `code`. */
export type BridgeErrorCode =
  | 'invalid_config'
  | 'no_credentials'
  | 'provider_error'
  | 'timeout'
  | 'internal'

export interface BridgeFrame {
  /** injected by bridge.py's emit(); absent on hand-written test frames */
  v?: number
  type: string
  /** frame-specific fields stay untyped here — the switch in parseLines narrows them */
  [key: string]: any
}

export type FrameResult =
  | { ok: true; frame: BridgeFrame }
  | { ok: false; reason: 'not-json' | 'not-object' | 'no-type' | 'unsupported-version'; detail?: string }

export function parseFrame(line: string): FrameResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (e) {
    return { ok: false, reason: 'not-json', detail: (e as Error).message }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object' }
  }
  const frame = parsed as BridgeFrame
  const v = frame.v
  if (v !== undefined && v !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported-version', detail: `v=${String(v)}` }
  }
  if (typeof frame.type !== 'string' || !frame.type) {
    return { ok: false, reason: 'no-type' }
  }
  return { ok: true, frame }
}

/** Narrow a parsed frame to one of the known error classes (default internal). */
export function errorCodeOf(frame: BridgeFrame): BridgeErrorCode {
  const code = frame.code
  return code === 'invalid_config' || code === 'no_credentials' || code === 'provider_error' || code === 'timeout'
    ? code
    : 'internal'
}
