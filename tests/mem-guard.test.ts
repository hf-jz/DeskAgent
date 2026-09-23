import { describe, it, expect, vi, beforeEach } from 'vitest'

// The guard's decisions are what keep a memory spike from freezing the app, so
// they are asserted here against a fake Electron metric table + fake bridge
// manager (the real one is driven end-to-end by the pinned-bubble run).
const metrics: { pid: number; type: string; memory: { workingSetSize: number } }[] = []
const winContents: any[] = []

vi.mock('electron', () => ({
  app: { getAppMetrics: () => metrics },
  webContents: { getAllWebContents: () => winContents },
}))

const bridge = {
  activeCount: 0,
  totalCount: 0,
  processStats: () => [] as { key: string; pid: number | null; busy: boolean }[],
  estimatedMemoryMB: () => 0,
  reapIdle: vi.fn((_o?: unknown) => [] as string[]),
  dropSpare: vi.fn(() => false),
}
vi.mock('../src/main/agents/desktop-agent', () => ({
  bridgeManager: bridge,
  BRIDGE_MB_ESTIMATE: 135,
}))

const { tick, sampleMemory, measureRssMB } = await import('../src/main/mem-guard')

const resetBridges = (count: number, mb: number) => {
  bridge.activeCount = count
  bridge.totalCount = mb === 0 ? 0 : count
  // fake pids never resolve → sampleMemory falls back to BRIDGE_MB_ESTIMATE × total
  bridge.processStats = () => Array.from({ length: count }, (_, i) => ({ key: `k${i}`, pid: 990000 + i, busy: false }))
  bridge.estimatedMemoryMB = () => mb
  bridge.reapIdle.mockReset().mockReturnValue([])
  bridge.dropSpare.mockReset().mockReturnValue(false)
}

beforeEach(() => {
  metrics.length = 0
  winContents.length = 0
  resetBridges(0, 0)
})

describe('memory guard', () => {
  it('under the soft limit: only the routine background reap, no pressure action', () => {
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 100 * 1024 } })
    metrics.push({ pid: 2, type: 'Tab', memory: { workingSetSize: 100 * 1024 } })
    resetBridges(1, 135)
    tick()
    expect(bridge.reapIdle).toHaveBeenCalledTimes(1)
    expect(bridge.reapIdle.mock.calls[0][0]).toEqual({ maxIdleMs: 30 * 60_000 })
    expect(bridge.dropSpare).not.toHaveBeenCalled()
  })

  it('over the soft limit: reaps every unpinned bridge and drops the warm spare', () => {
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 1000 * 1024 } })
    metrics.push({ pid: 2, type: 'Tab', memory: { workingSetSize: 500 * 1024 } })
    resetBridges(3, 405)
    tick() // total = 1500 + 405 > 1200
    const calls = bridge.reapIdle.mock.calls.map((c) => c[0])
    expect(calls).toEqual([{ maxIdleMs: 30 * 60_000 }, { maxIdleMs: 0 }])
    expect(bridge.dropSpare).toHaveBeenCalledTimes(1)
  })

  it('reloads a runaway renderer exactly once per cooldown', () => {
    const reload = vi.fn()
    winContents.push({ getOSProcessId: () => 7, isDestroyed: () => false, reload })
    metrics.push({ pid: 7, type: 'Tab', memory: { workingSetSize: 1100 * 1024 } })
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 200 * 1024 } })
    resetBridges(0, 0)
    tick()
    expect(reload).toHaveBeenCalledTimes(1)
    tick() // 10-minute cooldown — must not reload again
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a healthy renderer is never reloaded', () => {
    const reload = vi.fn()
    winContents.push({ getOSProcessId: () => 9, isDestroyed: () => false, reload })
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 1000 * 1024 } }) // force pressure
    metrics.push({ pid: 9, type: 'Tab', memory: { workingSetSize: 120 * 1024 } })
    resetBridges(3, 405)
    tick()
    expect(reload).not.toHaveBeenCalled()
  })

  it('sampleMemory separates Electron types and adds the bridge estimate', () => {
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 64 * 1024 } })
    metrics.push({ pid: 2, type: 'GPU', memory: { workingSetSize: 32 * 1024 } })
    metrics.push({ pid: 3, type: 'Tab', memory: { workingSetSize: 128 * 1024 } })
    resetBridges(2, 270)
    const s = sampleMemory()
    expect(Math.round(s.electronMB)).toBe(224)
    expect(s.byType.GPU).toBe(32)
    expect(s.renderers).toEqual([{ pid: 3, mb: 128 }])
    expect(s.bridges).toBe(2)
    expect(s.totalMB).toBe(494)
  })

  it('measures a live bridge instead of charging the 135MB constant', () => {
    metrics.push({ pid: 1, type: 'Browser', memory: { workingSetSize: 100 * 1024 } })
    // our own node process is a real, probeable pid with a real RSS
    bridge.totalCount = 1
    bridge.processStats = () => [{ key: 'x', pid: process.pid, busy: false }]
    const s = sampleMemory()
    const real = measureRssMB(process.pid)
    expect(real).toBeGreaterThan(0)
    expect(Math.round(s.bridgeMB)).toBe(Math.round(real!)) // measured, not 135
    expect(Math.round(s.totalMB)).toBe(Math.round(100 + real!))
  })

  it('measureRssMB returns null for a dead pid (caller falls back to the constant)', () => {
    expect(measureRssMB(999999)).toBeNull()
  })
})
