/**
 * 习惯提取器 — 从活动数据中挖掘习惯
 *
 * 两条路径（按设计文档 §5）：
 *   1. 算法路径（免费，每天执行）：统计聚类 → candidate 习惯卡
 *   2. LLM 路径（每周，planner 用）：语义级跨天归纳（Phase 2+ 启用）
 *
 * 本模块实现路径 1 的所有统计算法。
 */
import type { ActivitySegment, HabitCard, HabitKind } from './types'
import {
  getSegmentsForDate, insertHabit, getAllHabits,
  updateHabit, getHabitsByStatus,
} from './store'
import { localDateStr, localDateOffset } from './util'

// ── 时间例程检测 ──

interface TimeSlot {
  app: string
  titles: string[]
  hour: number       // 0-23，该习惯的典型小时
  count: number
  days: Set<string>  // 出现过的日期
}

/**
 * 检测时间例程：同一时段（±1h）反复出现相同 app。
 * 至少 3 天出现 → candidate 习惯卡。
 */
function detectTimeRoutines(segments: ActivitySegment[], date: string): HabitCard[] {
  // 按 (hour, app) 分组统计。days 必须记录每个 segment 自己所在的日期
  // （从 startTs 推导），否则跨天数据全被打上同一个 date 标签，
  // days.size 永远为 1，"≥3 天"条件恒不成立——时间例程永远检测不出。
  const slots = new Map<string, TimeSlot>()
  for (const s of segments) {
    const h = new Date(s.startTs).getHours()
    const segDate = localDateStr(s.startTs)
    const key = `${h}|${s.app}`
    const slot = slots.get(key)
    if (slot) {
      slot.count++
      if (!slot.titles.includes(s.title) && slot.titles.length < 5) slot.titles.push(s.title)
      slot.days.add(segDate)
    } else {
      slots.set(key, {
        app: s.app,
        titles: s.title ? [s.title] : [],
        hour: h,
        count: 1,
        days: new Set([segDate]),
      })
    }
  }

  const habits: HabitCard[] = []
  const existing = getAllHabits()

  for (const [, slot] of Array.from(slots)) {
    // 同一天内至少 2 次，且总出现 ≥ 3 天
    if (slot.count < 2 || slot.days.size < 3) continue

    // 检查是否已有同类习惯（按 kind + 名称 + 触发时段匹配；
    // 名称里的 hour 未补零，trigger 里的补零，所以不能靠字符串互查）
    const name = `${slot.hour}:00 打开${slot.app}`
    const paddedRange = `${String(slot.hour).padStart(2, '0')}:00`
    const dup = existing.find(h =>
      h.kind === 'time_routine' &&
      (h.name === name ||
        (h.triggerJson.includes(paddedRange) && h.patternJson.includes(slot.app)))
    )
    if (dup) {
      // 更新 evidence
      updateHabit(dup.id!, {
        evidenceCount: (dup.evidenceCount || 0) + 1,
        lastSeen: date,
        confidence: Math.min(1, (dup.confidence || 0.5) + 0.05),
      })
      continue
    }

    const getDayStr = (h: number): string[] => {
      const days: string[] = []
      if (h >= 8 && h < 12) days.push('mon', 'tue', 'wed', 'thu', 'fri')
      else days.push('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      return days
    }

    habits.push({
      name,
      kind: 'time_routine',
      triggerJson: JSON.stringify({
        time_range: `${String(slot.hour).padStart(2, '0')}:00-${String(slot.hour + 1).padStart(2, '0')}:00`,
        days: getDayStr(slot.hour),
      }),
      patternJson: JSON.stringify({
        apps: [slot.app],
        titles_sample: slot.titles.slice(0, 3),
      }),
      confidence: Math.min(0.7, 0.4 + slot.days.size * 0.1),
      evidenceCount: slot.days.size,
      firstSeen: date,
      lastSeen: date,
      status: 'candidate',
      userNote: '',
    })
  }

  return habits
}

// ── 上下文偏好检测 ──

/**
 * 检测上下文偏好：某些 app 总在特定条件下出现
 * （如：打完 VSCode 后总是打开 Terminal）
 */
function detectContextPreferences(segments: ActivitySegment[]): HabitCard[] {
  const habits: HabitCard[] = []
  const existing = getAllHabits()

  // 统计 app 转换对
  const transitions = new Map<string, number>()
  for (let i = 1; i < segments.length; i++) {
    const from = segments[i - 1].app
    const to = segments[i].app
    if (from === to) continue
    const key = `${from}→${to}`
    transitions.set(key, (transitions.get(key) || 0) + 1)
  }

  // 至少 5 次转换才算
  for (const [key, count] of Array.from(transitions)) {
    if (count < 5) continue
    const [app1, app2] = key.split('→')
    const name = `打开${app1}后常开${app2}`

    if (existing.find(h => h.name === name)) continue

    habits.push({
      name,
      kind: 'context',
      triggerJson: JSON.stringify({ app: app1 }),
      patternJson: JSON.stringify({ apps: [app1, app2] }),
      confidence: Math.min(0.7, 0.3 + count * 0.05),
      evidenceCount: count,
      firstSeen: localDateStr(),
      lastSeen: localDateStr(),
      status: 'candidate',
      userNote: '',
    })
  }

  return habits
}

// ── 序列模式检测 ──

/**
 * 检测操作序列：固定顺序的 app 使用序列。
 * 如：VSCode → Terminal → Chrome → VSCode
 */
function detectSequences(segments: ActivitySegment[], minLen: number = 3, maxLen: number = 5): HabitCard[] {
  const habits: HabitCard[] = []
  const existing = getAllHabits()

  // 简化：按 app 去重序列
  const appSeq = segments.map(s => s.app)
  const seen = new Set<string>()

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i <= appSeq.length - len; i++) {
      const slice = appSeq.slice(i, i + len)
      // 去重连续相同的
      const deduped: string[] = []
      for (const a of slice) {
        if (deduped[deduped.length - 1] !== a) deduped.push(a)
      }
      if (deduped.length < 2) continue

      const key = deduped.join(' → ')
      if (seen.has(key)) continue
      seen.add(key)

      // 统计这个序列在全部 segments 中出现的次数
      let count = 0
      const fullDeduped: string[] = []
      for (const a of appSeq) {
        if (fullDeduped[fullDeduped.length - 1] !== a) fullDeduped.push(a)
      }
      for (let j = 0; j <= fullDeduped.length - deduped.length; j++) {
        if (deduped.every((a, k) => fullDeduped[j + k] === a)) count++
      }

      if (count < 3) continue

      const name = deduped.join(' → ')
      if (existing.find(h => h.name === name)) continue

      habits.push({
        name,
        kind: 'sequence',
        triggerJson: JSON.stringify({ app: deduped[0] }),
        patternJson: JSON.stringify({ sequence: deduped }),
        confidence: Math.min(0.65, 0.25 + count * 0.08),
        evidenceCount: count,
        firstSeen: localDateStr(),
        lastSeen: localDateStr(),
        status: 'candidate',
        userNote: '',
      })
    }
  }

  return habits
}

// ── 总入口 ──

export interface ExtractionResult {
  date: string
  newHabits: HabitCard[]
  updatedHabits: number
  totalCandidates: number
}

/**
 * 对指定日期运行全部统计算法，产出 candidate 习惯卡。
 */
export function extractHabits(date: string): ExtractionResult {
  const segments = getSegmentsForDate(date)
  if (segments.length === 0) {
    return { date, newHabits: [], updatedHabits: 0, totalCandidates: 0 }
  }

  // 需要多天数据做统计（时间例程需要跨天对比）
  // 取最近 7 天的 segments 合并分析（日期键统一用本地时区）
  const allSegments: ActivitySegment[] = []
  const baseDay = new Date(date + 'T12:00:00') // 中午锚定，避免 DST 边缘
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDay)
    d.setDate(d.getDate() - i)
    allSegments.push(...getSegmentsForDate(localDateStr(d)))
  }

  const timeRoutines = detectTimeRoutines(allSegments, date)
  const contextPrefs = detectContextPreferences(segments)
  const sequences = detectSequences(segments)

  const newHabits = [...timeRoutines, ...contextPrefs, ...sequences]

  // 持久化
  for (const h of newHabits) {
    insertHabit(h)
  }

  return {
    date,
    newHabits,
    updatedHabits: 0, // 更新计数已在 detectTimeRoutines 里单独处理
    totalCandidates: getHabitsByStatus('candidate').length,
  }
}
