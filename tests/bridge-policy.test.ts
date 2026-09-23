import { describe, it, expect } from 'vitest'
import { selectReaps, type BridgeStat } from '../src/main/agents/bridge-policy'

const NOW = 1_700_000_000_000

const stat = (key: string, idleMs: number, extra: Partial<BridgeStat> = {}): BridgeStat => ({
  key,
  busy: false,
  lastUsedAt: NOW - idleMs,
  ...extra,
})

const opts = (o: Partial<{ maxIdleMs: number; maxLive: number }> = {}) => ({
  now: NOW,
  maxIdleMs: o.maxIdleMs ?? Infinity,
  maxLive: o.maxLive ?? 4,
})

describe('bridge reaping policy', () => {
  it('reaps a bridge idle past maxIdleMs', () => {
    const reaped = selectReaps([stat('automation', 11 * 60_000), stat('gen-ui', 60_000)], opts({ maxIdleMs: 10 * 60_000 }))
    expect(reaped).toEqual(['automation'])
  })

  it('never reaps a busy bridge', () => {
    const reaped = selectReaps([stat('automation', 60 * 60_000, { busy: true })], opts({ maxIdleMs: 0 }))
    expect(reaped).toEqual([])
  })

  it('never reaps a pinned bridge (open bubble window)', () => {
    const stats = [stat('1', 60 * 60_000, { pinned: true }), stat('2', 60 * 60_000, { pinned: true }), stat('gen-ui', 1000)]
    expect(selectReaps(stats, opts({ maxIdleMs: 0 }))).toEqual(['gen-ui'])
    // pinned entries still count toward the cap but are never selected for it
    expect(selectReaps(stats, opts({ maxLive: 1 }))).toEqual(['gen-ui'])
  })

  it('over budget → least recently used unpinned first', () => {
    const reaped = selectReaps(
      [stat('old', 9000), stat('mid', 5000), stat('new', 1000)],
      opts({ maxLive: 2 }),
    )
    expect(reaped).toEqual(['old'])
  })

  it('over budget with everything busy → reaps nothing (never kill work)', () => {
    const reaped = selectReaps([stat('a', 1000, { busy: true }), stat('b', 2000, { busy: true })], opts({ maxLive: 1 }))
    expect(reaped).toEqual([])
  })

  it('idle rule and budget rule compose without double-reaping', () => {
    const reaped = selectReaps(
      [stat('idle', 60 * 60_000), stat('k1', 5000), stat('k2', 3000), stat('k3', 1000)],
      opts({ maxIdleMs: 10 * 60_000, maxLive: 2 }),
    )
    expect(reaped.sort()).toEqual(['idle', 'k1'])
  })
})
