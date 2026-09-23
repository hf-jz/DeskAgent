import { describe, it, expect, vi } from 'vitest'
import { acquireTurnSlot, queueStats } from '../src/main/turn-queue'

// MAX_TURNS defaults to 4 (DESKAPP_MAX_TURNS is unset under vitest)
const MAX = 4

describe('turn queue (admission control)', () => {
  it('hands out slots immediately while under the cap', async () => {
    const held = Array.from({ length: MAX }, (_, i) => acquireTurnSlot(`h${i}`))
    const slots = await Promise.all(held.map((h) => h.wait))
    expect(slots.every(Boolean)).toBe(true)
    expect(queueStats()).toMatchObject({ running: MAX, waiting: 0, max: MAX })

    for (const s of slots) s!.release()
    expect(queueStats()).toMatchObject({ running: 0, waiting: 0 })
  })

  it('queues past the cap, reports the wait position, then runs FIFO', async () => {
    const held = Array.from({ length: MAX }, (_, i) => acquireTurnSlot(`h${i}`))
    await Promise.all(held.map((h) => h.wait))

    const seen: string[] = []
    const p5 = acquireTurnSlot('t5', (pos) => seen.push(`t5@${pos}`))
    const p6 = acquireTurnSlot('t6', (pos) => seen.push(`t6@${pos}`))
    expect(seen).toEqual(['t5@1', 't6@2'])
    expect(queueStats()).toMatchObject({ running: MAX, waiting: 2 })

    // one slot back → only the first waiter starts
    const s0 = await held[0].wait
    s0!.release()
    const s5 = await p5.wait
    expect(s5).toBeTruthy()
    expect(queueStats()).toMatchObject({ running: MAX, waiting: 1 })

    const s1 = await held[1].wait
    s1!.release()
    const s6 = await p6.wait
    expect(s6).toBeTruthy()
    expect(queueStats().waiting).toBe(0)

    for (const s of [s5, s6]) s!.release()
    for (const h of held.slice(2)) (await h.wait)!.release()
    expect(queueStats().running).toBe(0)
  })

  it('a queued turn can be cancelled before it starts (renderer abort works)', async () => {
    const held = Array.from({ length: MAX }, (_, i) => acquireTurnSlot(`h${i}`))
    const slots = await Promise.all(held.map((h) => h.wait))

    const victim = acquireTurnSlot('victim')
    expect(queueStats().waiting).toBe(1)
    victim.cancel()

    expect(queueStats().waiting).toBe(0) // dropped out of the queue
    await expect(victim.wait).resolves.toBeNull()

    // a cancelled waiter must not eat the slot the next one needs
    const next = acquireTurnSlot('next')
    slots[0]!.release()
    const sNext = await next.wait
    expect(sNext).toBeTruthy()
    sNext!.release()
    for (const s of slots.slice(1)) s!.release()
    expect(queueStats()).toMatchObject({ running: 0, waiting: 0 })
  })

  it('release is idempotent — a double release cannot inflate capacity', async () => {
    const a = (await acquireTurnSlot('a').wait)!
    a.release()
    a.release()
    a.release()
    expect(queueStats().running).toBe(0)

    const held = Array.from({ length: MAX }, (_, i) => acquireTurnSlot(`m${i}`))
    const many = await Promise.all(held.map((h) => h.wait))
    expect(many.every(Boolean)).toBe(true) // capacity intact
    for (const m of many) m!.release()
    expect(queueStats().running).toBe(0)
  })

  it('cancel after the slot was handed over is a no-op (abort goes through AbortHandle)', async () => {
    const p = acquireTurnSlot('running')
    p.cancel() // still queued here only if the cap was full; fresh module → it runs
    const s = await p.wait
    expect(s).toBeTruthy()
    p.cancel() // must NOT release the slot twice or free it early
    expect(queueStats().running).toBe(1)
    s!.release()
    expect(queueStats().running).toBe(0)
  })

  it('watchdog force-releases a slot whose backend never ends the turn', async () => {
    vi.resetModules()
    vi.stubEnv('DESKAPP_TURN_SLOT_MAX_MS', '30')
    const fresh = await import('../src/main/turn-queue')
    const p = fresh.acquireTurnSlot('wedged')
    await p.wait // holds a slot
    expect(fresh.queueStats().running).toBe(1)
    await new Promise((r) => setTimeout(r, 80)) // watchdog fires
    expect(fresh.queueStats().running).toBe(0)
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
