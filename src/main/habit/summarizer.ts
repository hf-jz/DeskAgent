/**
 * 摘要生成器 — 双模式：本地统计（默认）+ LLM 语义（opt-in）
 *
 * 隐私优先：默认只做本地统计聚合，不发送任何数据到外部 API。
 * 用户在设置中开启「AI 摘要」后，脱敏数据才会发给 LLM。
 */
import type { ActivitySegment, DailySummary } from './types'
import { getSegmentsForDate, getSummary, insertSummary, getRecentSummaries } from './store'
import { generalizeApp } from './privacy'
import { localDateStr } from './util'

// ── 本地统计摘要（默认，零泄露） ──

/**
 * 纯本地统计摘要——不调用任何外部 API，不离开本机。
 * 返回格式化的中文文本。
 */
function generateLocalSummary(segments: ActivitySegment[]): string {
  if (segments.length === 0) return '今天没有任何记录的活动。'

  // 按泛化应用名聚合
  const appTime = new Map<string, { totalMs: number; titles: string[] }>()
  const appRaw = new Map<string, number>() // 原始 app 名 → 时长（保留精确名用于本地）

  for (const s of segments) {
    const key = generalizeApp(s.app)
    const entry = appTime.get(key) || { totalMs: 0, titles: [] }
    entry.totalMs += s.durationMs
    if (s.title && !entry.titles.includes(s.title)) entry.titles.push(s.title)
    appTime.set(key, entry)
    appRaw.set(s.app, (appRaw.get(s.app) || 0) + s.durationMs)
  }

  const sorted = Array.from(appTime.entries())
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 8)

  const totalMin = Math.round(segments.reduce((s, seg) => s + seg.durationMs, 0) / 60000)
  const appCount = appTime.size

  const lines: string[] = []
  lines.push(`今日活跃 ${totalMin} 分钟，涉及 ${appCount} 个应用。`)

  for (const [app, info] of sorted) {
    const mins = Math.round(info.totalMs / 60000)
    const pct = totalMin > 0 ? Math.round((info.totalMs / (totalMin * 60000)) * 100) : 0
    lines.push(`${app}: ${mins} 分钟 (${pct}%)`)
  }

  return lines.join('\n')
}

// ── LLM 语义摘要（opt-in，脱敏后发送） ──

/**
 * 将活动段压缩为脱敏文本，用于发给 LLM。
 * 与本地版的关键区别：应用名泛化、标题完全剔除。
 */
function segmentsToLLMText(segments: ActivitySegment[]): string {
  if (segments.length === 0) return '今天没有任何记录的活动。'

  const appTime = new Map<string, number>()
  for (const s of segments) {
    const key = generalizeApp(s.app)
    appTime.set(key, (appTime.get(key) || 0) + s.durationMs)
  }

  const sorted = Array.from(appTime.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const lines: string[] = ['今日活动记录（仅应用类别）：']
  for (const [app, ms] of sorted) {
    const mins = Math.round(ms / 60000)
    lines.push(`- ${app}：${mins} 分钟`)
  }
  return lines.join('\n')
}

function llmSummaryPrompt(dayText: string): string {
  return `你是用户的使用习惯观察员。请根据今天的活动记录，写一段简洁的中文摘要（≤100字）。

要求：
1. 概括今天主要在做什么（应用类别和时间分布）
2. 不要评价好坏，不要提建议，只客观描述
3. 不要推断用户的身份、职业、公司或项目名称

${dayText}

【今日摘要】`
}

// ── 公开 API ──

export interface SummaryResult {
  date: string
  text: string
  segmentCount: number
  mode: 'local' | 'llm'
}

/**
 * 为指定日期生成摘要。
 *
 * @param date           日期 "2026-07-24"
 * @param summarizeFn    可选的 LLM 摘要函数。传入时走 LLM 路径，否则走本地统计。
 */
export async function generateDailySummary(
  date: string,
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<SummaryResult | null> {
  const segments = getSegmentsForDate(date)
  if (segments.length === 0) return null

  const existing = getSummary(date, 'daily')
  if (existing) return { date, text: existing.text, segmentCount: segments.length, mode: 'local' }

  let text: string
  let mode: 'local' | 'llm' = 'local'

  if (summarizeFn) {
    // LLM 路径：脱敏后发送
    const dayText = segmentsToLLMText(segments)
    const prompt = llmSummaryPrompt(dayText)
    console.log(`[Summarizer] LLM summary for ${date}`)
    text = await summarizeFn(prompt)
    mode = 'llm'
  } else {
    // 本地路径：纯统计
    console.log(`[Summarizer] local summary for ${date}, ${segments.length} segments`)
    text = generateLocalSummary(segments)
  }

  insertSummary({ date, period: 'daily', text, habitRefs: [] })
  return { date, text, segmentCount: segments.length, mode }
}

/** 补齐过去 N 天的摘要 */
export async function backfillSummaries(
  days: number,
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<number> {
  let count = 0
  const now = new Date()
  for (let i = 1; i <= days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = localDateStr(d) // C14: 本地时区，与 getSegmentsForDate 口径一致
    const result = await generateDailySummary(dateStr, summarizeFn)
    if (result) count++
  }
  return count
}
