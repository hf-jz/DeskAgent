import { describe, it, expect } from 'vitest'
import { parseCron, cronMatchesDay, cronDaysInRange, fmtDay } from '../src/shared/cron-days'

describe('parseCron', () => {
  it('accepts * and comma lists', () => {
    const p = parseCron('0 9,17 * * *')!
    expect(p.hours).toEqual([9, 17])
    expect(p.dom).toEqual([])
  })
  it('accepts ranges and steps', () => {
    const p = parseCron('*/30 9,10,11,13,14,15 * * 1-5')!
    expect(p.minutes).toEqual([0, 30])
    expect(p.dow).toEqual([1, 2, 3, 4, 5])
  })
  it('rejects malformed', () => {
    expect(parseCron('0 9,17 * *')).toBeNull()
    expect(parseCron('60 * * * *')).toBeNull()
    expect(parseCron('0 25 * * *')).toBeNull()
    expect(parseCron('0 * * * abc')).toBeNull()
  })
})

describe('cronMatchesDay', () => {
  it('daily fires every day', () => {
    const p = parseCron('0 9 * * *')!
    expect(cronMatchesDay(p, new Date(2026, 7, 5))).toBe(true)
  })
  it('weekday-only (1-5) skips weekend', () => {
    const p = parseCron('0 8 * * 1-5')!
    // 2026-08-05 = Wednesday, 2026-08-08 = Saturday
    expect(cronMatchesDay(p, new Date(2026, 7, 5))).toBe(true)
    expect(cronMatchesDay(p, new Date(2026, 7, 8))).toBe(false)
  })
  it('month-restricted fires only in that month', () => {
    const p = parseCron('0 9 * 6 *')!
    expect(cronMatchesDay(p, new Date(2026, 5, 15))).toBe(true)
    expect(cronMatchesDay(p, new Date(2026, 6, 15))).toBe(false)
  })
  it('both dom and dow restricted → OR rule', () => {
    const p = parseCron('0 9 15 * 1')! // 15th OR Monday
    expect(cronMatchesDay(p, new Date(2026, 7, 15))).toBe(true) // Saturday the 15th
    expect(cronMatchesDay(p, new Date(2026, 7, 17))).toBe(true) // Monday the 17th
    expect(cronMatchesDay(p, new Date(2026, 7, 19))).toBe(false) // Wednesday the 19th
  })
})

describe('cronDaysInRange', () => {
  it('returns all firing days inclusive', () => {
    const days = cronDaysInRange('0 9,17 * * *', new Date(2026, 7, 3), new Date(2026, 7, 5))
    expect(days).toHaveLength(3)
    expect(fmtDay(days[0])).toBe('8.3')
    expect(fmtDay(days[2])).toBe('8.5')
  })
  it('empty for malformed schedule', () => {
    expect(cronDaysInRange('garbage', new Date(), new Date())).toEqual([])
  })
})
