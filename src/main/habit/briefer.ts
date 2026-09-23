/**
 * 主动服务引擎 — 晨间简报、习惯注入、偏离提醒
 *
 * Phase 3: 隐私优先的上下文注入。
 *  - preference 类习惯始终注入（安全：偏好不泄露行为）
 *  - time_routine/context 类只在用户消息匹配到相关话题时注入
 *  - 偏离提醒保持关怀式
 */
import type { HabitCard, ActivitySegment, DailySummary } from './types'
import {
  getSummary, getRecentSummaries, getSegmentsForDate,
  getAllHabits, getHabitsByStatus, getPendingSuggestions,
} from './store'
import { localDateStr, localDateOffset } from './util'

// ── 晨间简报 ──

export interface MorningBriefing {
  greeting: string
  yesterdaySummary: string
  todayRoutines: { name: string; trigger: string; confidence: number }[]
  pendingSuggestions: string[]
  tip: string
}

export function composeMorningBriefing(): MorningBriefing {
  const now = new Date()
  const hour = now.getHours()

  let greeting: string
  if (hour < 6) greeting = '夜深了，还在工作？'
  else if (hour < 9) greeting = '早上好 ☀️'
  else if (hour < 12) greeting = '上午好'
  else if (hour < 14) greeting = '中午好'
  else if (hour < 18) greeting = '下午好'
  else if (hour < 22) greeting = '晚上好'
  else greeting = '夜深了，该休息了 🌙'

  const yesterdayStr = localDateOffset(-1)
  const yesterdaySummary = getSummary(yesterdayStr, 'daily')

  const activeHabits = getHabitsByStatus('active')
  const confirmedHabits = getHabitsByStatus('confirmed')
  const todayRoutines: MorningBriefing['todayRoutines'] = []
  for (const h of [...activeHabits, ...confirmedHabits]) {
    if (h.kind !== 'time_routine') continue
    try {
      const trigger = JSON.parse(h.triggerJson)
      const triggerHour = parseInt((trigger.time_range || '').split(':')[0])
      if (!isNaN(triggerHour) && triggerHour > hour && triggerHour <= hour + 3) {
        todayRoutines.push({
          name: h.name,
          trigger: trigger.time_range || '',
          confidence: h.confidence,
        })
      }
    } catch { /* skip */ }
  }
  todayRoutines.sort((a, b) => b.confidence - a.confidence)

  const pendingSuggestions = getPendingSuggestions().map(s => {
    try { return JSON.parse(s.payload).summary || s.kind } catch { return s.kind }
  })

  const tips = [
    '把宠物拖到屏幕边缘，它会乖乖躲起来',
    'Cmd+Shift+M 随时召唤气泡',
  ]
  const tip = tips[now.getDate() % tips.length]

  return {
    greeting,
    yesterdaySummary: yesterdaySummary?.text || '暂无昨日摘要',
    todayRoutines,
    pendingSuggestions,
    tip,
  }
}

// ── 习惯注入对话上下文（隐私优先） ──

export interface HabitContext {
  /** 用户偏好（始终注入，不敏感） */
  preferences: string[]
  /** 与用户消息 topic 匹配的习惯（只在相关时注入） */
  matchedHabits: HabitCard[]
  /** 是否跳过注入（用户消息与任何习惯都不相关） */
  injected: boolean
}

/**
 * 从用户消息中提取关键词，用于匹配习惯。
 * 简单规则：中英文分词 + 习惯名/模式的子串匹配。
 */
function extractKeywords(message: string): Set<string> {
  const kw = new Set<string>()
  const lower = message.toLowerCase()

  // 常见中文词汇
  const zhWords = ['行情', '股票', '开盘', '收盘', '交易', '代码', '编程',
    '写', '开发', '调试', '测试', '构建', '部署', '编译', '分析',
    '数据', '周报', '日报', '总结', '整理', '回顾', '复盘',
    '文档', '笔记', '阅读', '搜索', '浏览', '邮件',
    '项目', '仓库', '文件', '终端', '配置', '安装',
  ]
  for (const w of zhWords) {
    if (lower.includes(w)) kw.add(w)
  }

  // 英文关键词
  const enWords = ['code', 'debug', 'test', 'build', 'deploy', 'commit',
    'push', 'review', 'trade', 'market', 'stock', 'data', 'docs', 'read',
    'write', 'compile', 'config', 'install', 'terminal', 'project',
  ]
  for (const w of enWords) {
    if (lower.includes(w)) kw.add(w)
  }

  return kw
}

/**
 * 检查习惯卡是否与用户消息相关（C16 改进版）。
 * 旧版只拿硬编码词表去碰习惯名，命中率极低；
 * 现在双向匹配：消息中提到习惯涉及的 app/序列/URL 即相关，
 * 或词表关键词同时出现在消息与习惯文本中。
 */
function isHabitRelevant(habit: HabitCard, message: string, keywords: Set<string>): boolean {
  const msg = (message || '').toLowerCase()
  if (!msg) return false

  let patternText = ''
  try {
    const pattern = JSON.parse(habit.patternJson)
    patternText = [
      ...(pattern.apps || []),
      ...(pattern.sequence || []),
      ...(pattern.urls || []),
      ...(pattern.titles_sample || []),
    ].join(' ')
  } catch { /* skip */ }

  const haystack = `${habit.name} ${patternText} ${habit.userNote || ''}`.toLowerCase()

  // 1. 消息直接提到习惯文本中的实体词（app 名 / 站点名，≥3 字符降噪）
  for (const token of haystack.split(/[^a-z0-9一-鿿]+/i)) {
    if (token.length >= 3 && msg.includes(token)) return true
  }

  // 2. 词表关键词双向命中
  for (const kw of Array.from(keywords)) {
    if (msg.includes(kw) && haystack.includes(kw)) return true
  }

  return false
}

/**
 * 根据用户消息检索相关习惯，按隐私分层返回：
 *   L1: preferences 始终注入
 *   L2: time_routine/context/workflow 只在消息匹配到时注入
 */
export function getHabitContext(
  userMessage?: string,
  currentApp?: string,
): HabitContext {
  const keywords = userMessage ? extractKeywords(userMessage) : new Set<string>()

  const allActive = [
    ...getHabitsByStatus('active'),
    ...getHabitsByStatus('confirmed'),
  ]

  const preferences: string[] = []
  const matchedHabits: HabitCard[] = []
  let injectedPreferences = false

  for (const h of allActive) {
    // L1: preferences → 始终注入
    if (h.kind === 'preference') {
      preferences.push(h.name + ': ' + h.patternJson)
      injectedPreferences = true
      continue
    }

    // L2: 只在关键词匹配时注入
    if (isHabitRelevant(h, userMessage || '', keywords)) {
      matchedHabits.push(h)
    }
  }

  return {
    preferences,
    matchedHabits,
    injected: injectedPreferences || matchedHabits.length > 0,
  }
}

/**
 * 将习惯上下文格式化为可注入 bridge 的文本。
 * 隐私保护：不暴露置信度、证据数、日期等元数据。
 */
export function formatHabitContext(ctx: HabitContext): string {
  const parts: string[] = []

  if (ctx.preferences.length > 0) {
    parts.push(ctx.preferences.slice(0, 3).map(p => `- ${p}`).join('\n'))
  }

  if (ctx.matchedHabits.length > 0) {
    parts.push(ctx.matchedHabits.slice(0, 3).map(h =>
      `- ${h.name}`
    ).join('\n'))
  }

  return parts.join('\n')
}

// ── 偏离提醒 ──

export interface DeviationAlert {
  habit: HabitCard
  message: string
  shouldAlert: boolean
}

// C17: 频率限制——同一习惯 4 小时冷却，全局每天最多 3 次。
// 旧版无冷却，每次查询都重复提醒，关怀变唠叨。
const alertLastFired = new Map<number, number>()
let alertDailyCount = 0
let alertDailyDate = ''
const ALERT_COOLDOWN_MS = 4 * 3600 * 1000
const ALERT_DAILY_CAP = 3

function canFireAlert(habitId: number): boolean {
  const today = localDateStr()
  if (alertDailyDate !== today) { alertDailyDate = today; alertDailyCount = 0 }
  if (alertDailyCount >= ALERT_DAILY_CAP) return false
  const last = alertLastFired.get(habitId) || 0
  return Date.now() - last >= ALERT_COOLDOWN_MS
}

function markAlertFired(habitId: number): void {
  alertLastFired.set(habitId, Date.now())
  alertDailyCount++
}

export function checkDeviations(currentApp?: string): DeviationAlert[] {
  const now = new Date()
  const hour = now.getHours()
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]

  const active = getHabitsByStatus('active')
  const alerts: DeviationAlert[] = []

  for (const h of active) {
    if (h.kind !== 'time_routine') continue
    try {
      const trigger = JSON.parse(h.triggerJson)
      const [startH] = (trigger.time_range || '0:00').split(':').map(Number)
      const days: string[] = trigger.days || []

      if (isNaN(startH) || !days.includes(day)) continue

      if (hour >= startH + 0.5 && hour <= startH + 3) {
        const pattern = JSON.parse(h.patternJson)
        const apps: string[] = pattern.apps || []
        if (currentApp && apps.includes(currentApp)) continue
        if (h.confidence < 0.7) continue
        if (!canFireAlert(h.id!)) continue

        markAlertFired(h.id!)
        alerts.push({
          habit: h,
          message: `平时这个时间你会${h.name}，今天还没开始 — 要我帮忙吗？`,
          shouldAlert: true,
        })
      }
    } catch { /* skip */ }
  }

  return alerts.slice(0, 1)
}
