import { describe, it, expect } from 'vitest'
import { parseFrame, errorCodeOf, PROTOCOL_VERSION } from '../src/main/agents/bridge-protocol'

describe('bridge protocol frames', () => {
  it('accepts a versioned frame', () => {
    const r = parseFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ready', active_provider: 'deepseek' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.frame.active_provider).toBe('deepseek')
  })

  it('accepts a frame without a version (hand-written test frames / legacy)', () => {
    const r = parseFrame('{"type":"warm"}')
    expect(r.ok).toBe(true)
  })

  it('rejects a newer protocol version instead of half-reading it', () => {
    const r = parseFrame('{"v":2,"type":"text","content":"hi"}')
    expect(r).toEqual({ ok: false, reason: 'unsupported-version', detail: 'v=2' })
  })

  it('rejects malformed and typeless lines', () => {
    expect(parseFrame('not json').ok).toBe(false)
    expect(parseFrame('[1,2]').ok).toBe(false)
    expect(parseFrame('{"v":1}')).toEqual({ ok: false, reason: 'no-type' })
  })

  it('maps error codes, defaulting to internal', () => {
    expect(errorCodeOf({ type: 'error', code: 'no_credentials' })).toBe('no_credentials')
    expect(errorCodeOf({ type: 'error', code: 'invalid_config' })).toBe('invalid_config')
    expect(errorCodeOf({ type: 'error', code: 'provider_error' })).toBe('provider_error')
    expect(errorCodeOf({ type: 'error', code: 'timeout' })).toBe('timeout')
    expect(errorCodeOf({ type: 'error' })).toBe('internal')
    expect(errorCodeOf({ type: 'error', code: 'weird' })).toBe('internal')
  })

  it('keeps the documented frame types parseable', () => {
    for (const line of [
      '{"v":1,"type":"ready"}',
      '{"v":1,"type":"reasoning","content":"hmm"}',
      '{"v":1,"type":"reasoning_end"}',
      '{"v":1,"type":"text","content":"hi"}',
      '{"v":1,"type":"done","elapsed_ms":10}',
      '{"v":1,"type":"permission_required","id":"a"}',
    ]) {
      expect(parseFrame(line).ok).toBe(true)
    }
  })
})
