// ── Habit Engineering · 共享工具 ──

/**
 * 本地时区日期串 "2026-07-24"。
 * 全习惯工程统一使用此函数生成日期键——toISOString() 是 UTC，
 * 在 UTC+8 的 0-8 点会把"今天"算成昨天，导致摘要/查询错位一天。
 */
export function localDateStr(d: Date | number = new Date()): string {
  const dt = typeof d === 'number' ? new Date(d) : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 相对今天 offset 天的本地日期串（offset=-1 为昨天） */
export function localDateOffset(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return localDateStr(d)
}
