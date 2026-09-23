/**
 * Habit Service — 习惯工程总调度
 *
 * 隐私优先：
 *  - 知情同意：未获用户明确授权前，采集器不启动（B11）
 *  - 采集层脱敏（URL 去参 + 标题清洗）→ collector + privacy.ts
 *  - 摘要默认本地统计，opt-in LLM → summarizer.ts 双模式
 *  - 上下文注入按意图过滤 → briefer.ts
 *  - 暂停 / AI 摘要 / 同意状态持久化到 deskapp-settings.json（B10）
 *  - 全部日期键使用本地时区（C14）
 */
import { app } from 'electron'
import { holdTurnSlot } from '../turn-queue'
import {
  initHabitStore, closeHabitStore, isReady,
  countEvents, countSegments, dailyMaintenance,
  getAllHabits, getRecentEvents, getHabitsByStatus,
  updateHabit, getSegmentsForDate, getSummary, getHabitStats,
  getRecentSummaries, insertSummary, deleteSummary,
} from './store'
import {
  startCollector, stopCollector, pauseCollector, resumeCollector, state,
} from './collector'
import { generateDailySummary, backfillSummaries } from './summarizer'
import { extractHabits } from './extractor'
import {
  composeMorningBriefing, getHabitContext, formatHabitContext,
  checkDeviations, type MorningBriefing, type HabitContext, type DeviationAlert,
} from './briefer'
import { runShadowAutomation } from './automation'
import { generalizeApp } from './privacy'
import { loadSettings, saveSettings } from '../settings-store'
import { localDateStr, localDateOffset } from './util'
import type { HabitServiceState, HabitCard } from './types'

let initialized = false
let storeReady = false
let maintenanceTimer: ReturnType<typeof setTimeout> | null = null
let pipelineTimer: ReturnType<typeof setTimeout> | null = null

// ── 隐私状态（持久化） ──
let habitEnabled = false    // B11: 知情同意，默认 false —— 未授权不观察
let paused = false          // 暂停观察
let aiSummaryEnabled = false // AI 摘要（opt-in）

function persistPrivacyFlags(): void {
  try {
    const s = loadSettings()
    saveSettings({
      ...s,
      habitConsent: habitEnabled,
      habitPaused: paused,
      habitAISummary: aiSummaryEnabled,
    })
  } catch (e) {
    console.warn('[HabitService] failed to persist privacy flags:', (e as Error).message)
  }
}

// ── LLM 摘要函数（走 worker 模型控成本；懒加载避免启动开销与循环依赖） ──

function makeSummarizeFn(): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    const { bridgeManager } = require('../agents/desktop-agent')
    const { WORKER_MODEL, WORKER_PROVIDER } = require('../agents/task-router')
    // Global turn slot: a summary is a real bridge turn too (see turn-queue.ts)
    const releaseSlot = await holdTurnSlot('habit:summary')
    try {
      return await new Promise<string>((resolve, reject) => {
        let text = ''
        const timer = setTimeout(() => reject(new Error('summary timeout (120s)')), 120000)
        bridgeManager.execute('habit-summary', prompt, {
          onChunk: (t: string) => { text += t },
          onDone: () => { clearTimeout(timer); resolve(text.trim()) },
          onError: (e: string) => { clearTimeout(timer); reject(new Error(e)) },
        }, { model: WORKER_MODEL, provider: WORKER_PROVIDER }).catch((e: Error) => {
          clearTimeout(timer)
          reject(e)
        })
      })
    } finally {
      releaseSlot()
    }
  }
}

// ── 公开 API ──

export function initHabitService(): void {
  if (initialized) return
  try {
    const s = loadSettings()
    habitEnabled = s.habitConsent === true
    paused = s.habitPaused === true
    aiSummaryEnabled = s.habitAISummary === true

    const dataDir = app.getPath('userData')
    initHabitStore(dataDir)
    storeReady = true

    if (habitEnabled) {
      startCollector()
      if (paused) pauseCollector()
      scheduleDailyPipeline()
      backfillYesterday().catch(e =>
        console.warn('[HabitService] backfill failed:', (e as Error).message))
    } else {
      console.log('[HabitService] consent not given — collector OFF, awaiting opt-in (B11)')
    }

    scheduleDailyMaintenance()
    initialized = true
    console.log('[HabitService] initialized — enabled:', habitEnabled,
      '| paused:', paused, '| AI summary:', aiSummaryEnabled)
  } catch (e) {
    // B11: better-sqlite3 原生绑定等初始化失败不应拖垮主进程
    console.error('[HabitService] init failed (habit engine disabled):', (e as Error).message)
    initialized = false
    storeReady = false
  }
}

export function shutdownHabitService(): void {
  try { stopCollector() } catch { /* ignore */ }
  if (maintenanceTimer) { clearTimeout(maintenanceTimer); maintenanceTimer = null }
  if (pipelineTimer) { clearTimeout(pipelineTimer); pipelineTimer = null }
  if (storeReady) closeHabitStore()
  storeReady = false
  initialized = false
  console.log('[HabitService] shutdown')
}

// ── 隐私开关 ──

export function isHabitEnabled(): boolean { return habitEnabled }

/** 用户知情同意（B11）。开启 → 启动采集；关闭 → 停止采集（数据保留，可另行删除）。 */
export function setHabitEnabled(enabled: boolean): void {
  if (enabled === habitEnabled) return
  habitEnabled = enabled
  persistPrivacyFlags()
  if (enabled && storeReady) {
    startCollector()
    if (paused) pauseCollector()
    scheduleDailyPipeline()
    backfillYesterday().catch(() => {})
  } else if (!enabled) {
    try { stopCollector() } catch { /* ignore */ }
    if (pipelineTimer) { clearTimeout(pipelineTimer); pipelineTimer = null }
  }
  console.log('[HabitService] habit observation:', enabled ? 'ENABLED' : 'DISABLED')
}

export function getServiceState(): HabitServiceState {
  return {
    collector: !habitEnabled ? 'idle' : state.paused ? 'paused' : state.running ? 'running' : 'idle',
    eventCount: storeReady ? countEvents() : 0,
    segmentCount: storeReady ? countSegments() : 0,
    lastSampleAt: state.lastSampleAt,
    privacyPaused: paused,
    habitEnabled,
    aiSummaryEnabled,
    collectorErrors: state.errorCount,
    lastCollectorError: state.lastError,
  }
}

export function setPrivacyPause(p: boolean): void {
  paused = p
  persistPrivacyFlags()
  if (p) pauseCollector()
  else resumeCollector()
  console.log('[HabitService] privacy pause:', p)
}

export function setAISummaryEnabled(enabled: boolean): void {
  aiSummaryEnabled = enabled
  persistPrivacyFlags()
  console.log('[HabitService] AI summary:', enabled ? 'enabled' : 'disabled')
}

export function isAISummaryEnabled(): boolean {
  return aiSummaryEnabled
}

// ── 数据查询（全部带 storeReady 防护，未授权/初始化失败时返回空而非崩溃） ──

export function queryRecentEvents(limit: number = 100) {
  return storeReady ? getRecentEvents(limit) : []
}

export function queryHabits() {
  return storeReady ? getAllHabits() : []
}

export function querySegments(date: string) {
  return storeReady ? getSegmentsForDate(date) : []
}

export function confirmHabit(id: number): void {
  if (storeReady) updateHabit(id, { status: 'confirmed' })
  // P1-B3: confirmed habits are auto-remembered as global memories
  try {
    const habits = getAllHabits()
    const card = habits.find((h: any) => h.id === id)
    if (card) {
      const text = `[习惯] ${card.name}`
      require('../memory/store').remember('global', text, { key: `habit-${id}` })
    }
  } catch { /* memory store unavailable */ }
}

export function dismissHabit(id: number): void {
  if (storeReady) updateHabit(id, { status: 'archived' })
}

export function activateHabit(id: number): void {
  if (storeReady) updateHabit(id, { status: 'active' })
}

// ── 简报 ──

export function getMorningBriefing(): MorningBriefing {
  if (!storeReady) {
    return {
      greeting: '你好',
      yesterdaySummary: '习惯引擎未启用',
      todayRoutines: [],
      pendingSuggestions: [],
      tip: '',
    }
  }
  try {
    return composeMorningBriefing()
  } catch (e) {
    console.warn('[HabitService] briefing failed:', (e as Error).message)
    return { greeting: '你好', yesterdaySummary: '', todayRoutines: [], pendingSuggestions: [], tip: '' }
  }
}

// ── 习惯上下文（每条对话消息都会经过 —— 绝不能抛异常） ──

export function getContextForApp(userMessage?: string, currentApp?: string): HabitContext {
  if (!storeReady || !habitEnabled) return { preferences: [], matchedHabits: [], injected: false }
  try {
    return getHabitContext(userMessage, currentApp)
  } catch {
    return { preferences: [], matchedHabits: [], injected: false }
  }
}

export function getContextText(userMessage?: string, currentApp?: string): string {
  try {
    return formatHabitContext(getContextForApp(userMessage, currentApp))
  } catch {
    return ''
  }
}

// ── 偏离检查 ──

export function getDeviations(currentApp?: string): DeviationAlert[] {
  if (!storeReady || !habitEnabled) return []
  try {
    return checkDeviations(currentApp)
  } catch {
    return []
  }
}

// ── 摘要 ──

export async function runDailySummary(
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<{ text: string | null; mode: string }> {
  if (!storeReady) return { text: null, mode: 'local' }
  const today = localDateStr()
  const result = await generateDailySummary(today, summarizeFn)
  return { text: result?.text || null, mode: result?.mode || 'local' }
}

export async function runBackfill(days: number,
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<number> {
  if (!storeReady) return 0
  return backfillSummaries(days, summarizeFn)
}

/** 启动时补齐：昨日摘要缺失则补（本地统计模式，除非已开启 AI 摘要） */
async function backfillYesterday(): Promise<void> {
  if (!storeReady) return
  const yesterday = localDateOffset(-1)
  if (getSummary(yesterday, 'daily')) return
  const segs = getSegmentsForDate(yesterday)
  if (segs.length === 0) return
  console.log('[HabitService] backfilling yesterday summary:', yesterday)
  await generateDailySummary(yesterday, aiSummaryEnabled ? makeSummarizeFn() : undefined)
}

// ── 习惯提取 ──

export function runExtraction(): { newHabits: number; totalCandidates: number } {
  if (!storeReady) return { newHabits: 0, totalCandidates: 0 }
  const today = localDateStr()
  const result = extractHabits(today)
  console.log('[HabitService] extraction:', result.newHabits.length, 'new habits,', result.totalCandidates, 'total candidates')
  return {
    newHabits: result.newHabits.length,
    totalCandidates: result.totalCandidates,
  }
}

// ── 影子自动化 ──

export function runAutomation() {
  if (!storeReady) return { workflows: [], proposals: [] }
  return runShadowAutomation()
}

// ── 每日管道 ──

export async function runDailyPipeline(
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<{ summary: string | null; mode: string; newHabits: number; totalCandidates: number; maintenance: string }> {
  if (!storeReady) return { summary: null, mode: 'local', newHabits: 0, totalCandidates: 0, maintenance: 'store not ready' }
  console.log('[HabitService] running daily pipeline (AI summary:', aiSummaryEnabled ? 'on' : 'off', ')')

  // 1. 摘要：根据设置选择本地或 LLM
  let summary: string | null = null
  let mode = 'local'
  try {
    const fn = aiSummaryEnabled ? (summarizeFn || makeSummarizeFn()) : undefined
    const result = await runDailySummary(fn)
    summary = result.text
    mode = result.mode
    console.log('[HabitService] summary done:', summary ? summary.slice(0, 50) + '...' : 'no activity')
  } catch (e) {
    console.error('[HabitService] summary failed:', (e as Error).message)
  }

  // 2. 提取习惯（A2 修复前此处崩溃会中断管道，现在独立防护）
  let extraction = { newHabits: 0, totalCandidates: 0 }
  try {
    extraction = runExtraction()
  } catch (e) {
    console.error('[HabitService] extraction failed:', (e as Error).message)
  }

  // 3. 每日维护
  try {
    dailyMaintenance()
  } catch (e) {
    console.error('[HabitService] maintenance failed:', (e as Error).message)
  }

  return { summary, mode, ...extraction, maintenance: 'cleanup done' }
}

export async function runWeeklyPipeline(
  summarizeFn?: (prompt: string) => Promise<string>,
) {
  const daily = await runDailyPipeline(summarizeFn)
  let auto: { workflows: HabitCard[]; proposals: unknown[] } = { workflows: [], proposals: [] }
  try {
    auto = runAutomation()
  } catch (e) {
    console.error('[HabitService] automation failed:', (e as Error).message)
  }
  // D: 周报 v2 —— AI 摘要开启时 LLM 叙事增强（失败自动降级本地统计）
  try {
    const fn = aiSummaryEnabled ? (summarizeFn || makeSummarizeFn()) : undefined
    await generateWeeklyReport(fn)
  } catch (e) {
    console.error('[HabitService] weekly report failed:', (e as Error).message)
  }
  return { ...daily, workflows: auto.workflows, proposals: auto.proposals }
}

// ── D: 懂你指数 ──

/**
 * 懂你指数 v1（0-100）：
 *  - 观察天数（40 满）：连续观察越久越懂你
 *  - 已确认+活跃习惯（30 满）：你认可过的卡片
 *  - 卡片平均置信度（20 满）：证据强度
 *  - 摘要积累（10 满）：每日摘要数量
 */
export function getScore(): number {
  if (!storeReady) return 0
  try {
    const s = getHabitStats()
    return Math.round(
      Math.min(40, s.daysObserved * 4) +
      Math.min(30, (s.confirmedCount + s.activeCount) * 5) +
      Math.round(s.avgConfidence * 20) +
      Math.min(10, s.summaryCount)
    )
  } catch {
    return 0
  }
}

// ── D: 懂你指数解读（v2：LLM 一句话解读，本地规则兜底，每日缓存控成本） ──

type HabitStats = ReturnType<typeof getHabitStats>

/** 本地规则解读——AI 摘要关闭或 LLM 失败时使用，零外发 */
function localScoreInsight(s: HabitStats, score: number): string {
  if (s.daysObserved === 0) return '观察还没开始，正常用几天电脑我就会开始懂你'
  const known = s.confirmedCount + s.activeCount
  if (s.daysObserved < 3) return `已观察 ${s.daysObserved} 天，正在学习你的节奏`
  if (known === 0) return `已观察 ${s.daysObserved} 天，去习惯卡页确认几张卡，我会更快懂你`
  if (score >= 70) return `${s.daysObserved} 天掌握 ${known} 个习惯，我已经相当懂你了`
  return `${s.daysObserved} 天掌握 ${known} 个习惯，懂你的程度还在成长`
}

function scoreInsightPrompt(s: HabitStats, score: number): string {
  return `你是住在用户电脑里的桌面伙伴。根据以下统计，用一句话（≤40字）告诉用户你现在有多懂他/她。

要求：
1. 第一人称"我"，语气温暖
2. 具体用到下面的数据，不说教，不给建议列表
3. 不推断用户身份、职业、公司或项目名称

统计：已观察 ${s.daysObserved} 天 · 每日摘要 ${s.summaryCount} 份 · 活跃+已确认习惯 ${s.confirmedCount + s.activeCount} 个 · 平均置信度 ${Math.round(s.avgConfidence * 100)}% · 懂你指数 ${score}/100

【一句话解读】`
}

function persistScoreInsight(insight: string, date: string, score: number): void {
  try {
    const s = loadSettings()
    saveSettings({
      ...s,
      habitScoreInsight: insight,
      habitScoreInsightDate: date,
      habitScoreInsightScore: score,
    })
  } catch { /* 缓存失败不影响主流程 */ }
}

/**
 * 懂你指数 + 一句话解读。
 * AI 摘要开启时走 LLM（每日缓存，score 漂移 >5 强制刷新，每天最多 1 次 LLM 调用）；
 * 关闭或 LLM 失败时用本地规则文本。数字部分永远是确定性公式。
 */
export async function getScoreInsight(): Promise<{ score: number; insight: string; source: 'llm' | 'local' }> {
  const score = getScore()
  if (!storeReady) return { score, insight: '习惯引擎未启用', source: 'local' }

  let stats: HabitStats
  try {
    stats = getHabitStats()
  } catch {
    return { score, insight: '', source: 'local' }
  }

  if (aiSummaryEnabled) {
    try {
      const today = localDateStr()
      const cached = loadSettings()
      if (cached.habitScoreInsight &&
        cached.habitScoreInsightDate === today &&
        Math.abs((cached.habitScoreInsightScore ?? -999) - score) <= 5) {
        return { score, insight: cached.habitScoreInsight, source: 'llm' }
      }
      const insight = (await makeSummarizeFn()(scoreInsightPrompt(stats, score))).trim()
      if (insight) {
        persistScoreInsight(insight, today, score)
        return { score, insight, source: 'llm' }
      }
    } catch (e) {
      console.warn('[HabitService] score insight LLM failed, fallback local:', (e as Error).message)
    }
  }
  return { score, insight: localScoreInsight(stats, score), source: 'local' }
}

// ── D: 例程一键执行 ──

/**
 * 执行已激活习惯的打开动作：macOS `open -a` 启动 app、`open` 打开 URL。
 * 只执行 pattern 中记录的 app/URL，不执行任意命令——注入面为零。
 */
export async function executeHabit(id: number): Promise<{ ok: boolean; opened: string[]; error?: string }> {
  if (!storeReady) return { ok: false, opened: [], error: '习惯引擎未就绪' }
  const habit = getAllHabits().find(h => h.id === id)
  if (!habit) return { ok: false, opened: [], error: '习惯不存在' }
  if (habit.status !== 'active' && habit.status !== 'confirmed') {
    return { ok: false, opened: [], error: '只有已确认/活跃的习惯可以执行' }
  }

  let apps: string[] = []
  let urls: string[] = []
  try {
    const p = JSON.parse(habit.patternJson)
    if (Array.isArray(p.apps)) apps = p.apps
    if (Array.isArray(p.sequence)) apps = [...new Set([...apps, ...p.sequence])]
    if (Array.isArray(p.urls)) urls = p.urls.filter((u: string) => /^https?:\/\//.test(u))
  } catch {
    return { ok: false, opened: [], error: '习惯模式数据损坏' }
  }

  const { execFile } = require('child_process')
  const opened: string[] = []
  const errors: string[] = []

  for (const appName of apps) {
    // 安全：只允许应用名字符串，open -a 不接受参数注入
    if (!/^[\w\s.\-一-鿿]+$/.test(appName) || appName.length > 60) continue
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('open', ['-a', appName], { timeout: 5000 }, (err: Error | null) => err ? reject(err) : resolve())
      })
      opened.push(appName)
    } catch (e) {
      errors.push(`${appName}: ${(e as Error).message}`)
    }
  }
  for (const u of urls.slice(0, 5)) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('open', [u], { timeout: 5000 }, (err: Error | null) => err ? reject(err) : resolve())
      })
      opened.push(u)
    } catch (e) {
      errors.push(`${u}: ${(e as Error).message}`)
    }
  }

  if (opened.length === 0) {
    return { ok: false, opened, error: errors.join('; ') || '没有可执行的动作' }
  }
  return { ok: true, opened, error: errors.length ? errors.join('; ') : undefined }
}

// ── D: 周报 v2（本地统计为底，AI 摘要开启时 LLM 叙事增强，失败自动降级） ──

interface WeeklyDigest {
  weekStart: string
  dayMinutes: { date: string; minutes: number }[]
  /** 原始 app 名 → 时长（仅本地渲染用，绝不外发） */
  appTotals: Map<string, number>
  /** 泛化类别 → 时长（LLM 负载用，与每日摘要同一脱敏标准） */
  categoryTotals: Map<string, number>
  totalHours: number
  newHabitNames: string[]
  statusCounts: { active: number; confirmed: number; candidate: number }
  score: number
}

function buildWeeklyDigest(monday: Date): WeeklyDigest {
  const weekStart = localDateStr(monday)
  const dayMinutes: WeeklyDigest['dayMinutes'] = []
  const appTotals = new Map<string, number>()
  const categoryTotals = new Map<string, number>()
  let totalMs = 0

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = localDateStr(d)
    let dayMs = 0
    for (const seg of getSegmentsForDate(dateStr)) {
      dayMs += seg.durationMs
      appTotals.set(seg.app, (appTotals.get(seg.app) || 0) + seg.durationMs)
      const cat = generalizeApp(seg.app)
      categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + seg.durationMs)
    }
    dayMinutes.push({ date: dateStr, minutes: Math.round(dayMs / 60000) })
    totalMs += dayMs
  }

  const habits = getAllHabits()
  return {
    weekStart,
    dayMinutes,
    appTotals,
    categoryTotals,
    totalHours: totalMs / 3600000,
    newHabitNames: habits.filter(h => h.firstSeen >= weekStart).map(h => h.name),
    statusCounts: {
      active: habits.filter(h => h.status === 'active').length,
      confirmed: habits.filter(h => h.status === 'confirmed').length,
      candidate: habits.filter(h => h.status === 'candidate').length,
    },
    score: getScore(),
  }
}

/** 本地统计文本（v1 口径）——含精确应用名，只留在本机 */
function renderLocalWeekly(digest: WeeklyDigest): string {
  const lines: string[] = [`📅 周报 ${digest.weekStart} 起`]
  if (digest.totalHours > 0) {
    lines.push(`本周共记录 ${digest.totalHours.toFixed(1)} 小时活跃时间`)
    const top = [...digest.appTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    lines.push('常用应用：' + top.map(([a, ms]) => `${a} ${(ms / 3600000).toFixed(1)}h`).join(' · '))
  } else {
    lines.push('本周暂无活动记录')
  }
  if (digest.newHabitNames.length > 0) {
    lines.push(`新发现 ${digest.newHabitNames.length} 个习惯：${digest.newHabitNames.slice(0, 3).join('、')}${digest.newHabitNames.length > 3 ? ' 等' : ''}`)
  }
  lines.push(`💜 懂你指数 ${digest.score}`)
  return lines.join('\n')
}

/** LLM 负载——只有泛化类别与计数，无精确应用名/标题/网址（与每日摘要同一脱敏标准） */
function weeklyPrompt(digest: WeeklyDigest): string {
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const days = digest.dayMinutes
    .map((d, i) => `${dayNames[i]} ${(d.minutes / 60).toFixed(1)}h`)
    .join(' · ')
  const cats = [...digest.categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, ms]) => `${c} ${(ms / 3600000).toFixed(1)}h`)
    .join(' · ')
  const sc = digest.statusCounts

  return `你是用户的电脑使用习惯观察员。根据本周脱敏统计数据写一段中文周报（≤120字）。

要求：
1. 先客观概括本周时间分布与节奏，再给一句温和可行的建议
2. 数据已脱敏（只有应用类别，没有具体标题和网址），不要编造细节
3. 不推断用户的身份、职业、公司或项目名称
4. 语气温暖，像朋友说话

本周统计：
- 总活跃 ${digest.totalHours.toFixed(1)} 小时
- 每日活跃：${days}
- 常用类别：${cats || '无'}
- 习惯卡：活跃 ${sc.active} · 已确认 ${sc.confirmed} · 候选 ${sc.candidate}（本周新发现 ${digest.newHabitNames.length} 个）
- 懂你指数：${digest.score}/100

【本周周报】`
}

/**
 * 生成本周报告并写入 summaries（period='weekly'，日期键=本周一）。
 * AI 摘要开启且本周有活动时走 LLM 叙事 + 本地数据附录；
 * 否则/失败时纯本地统计。重生成会先删旧周报，同一周不堆积。
 */
export async function generateWeeklyReport(
  summarizeFn?: (prompt: string) => Promise<string>,
): Promise<{ text: string; weekStart: string; mode: 'local' | 'llm' } | null> {
  if (!storeReady) return null
  const now = new Date()
  const monday = new Date(now)
  const dow = (now.getDay() + 6) % 7 // 周一=0
  monday.setDate(now.getDate() - dow)

  const digest = buildWeeklyDigest(monday)
  const localText = renderLocalWeekly(digest)

  let text = localText
  let mode: 'local' | 'llm' = 'local'
  if (summarizeFn && digest.totalHours > 0) {
    try {
      const narrative = (await summarizeFn(weeklyPrompt(digest))).trim()
      if (narrative) {
        text = `${narrative}\n\n—— 📊 本周数据 ——\n${localText}`
        mode = 'llm'
      }
    } catch (e) {
      console.warn('[HabitService] weekly LLM failed, fallback local:', (e as Error).message)
    }
  }

  deleteSummary(digest.weekStart, 'weekly')
  insertSummary({ date: digest.weekStart, period: 'weekly', text, habitRefs: [] })
  console.log('[HabitService] weekly report generated:', digest.weekStart, '| mode:', mode)
  return { text, weekStart: digest.weekStart, mode }
}

/** 取最近一份周报（供面板展示） */
export function getLatestWeeklyReport(): { text: string; date: string } | null {
  if (!storeReady) return null
  try {
    const weekly = getRecentSummaries(8).find(s => s.period === 'weekly')
    return weekly ? { text: weekly.text, date: weekly.date } : null
  } catch {
    return null
  }
}

// ── 调度 ──

function scheduleDailyMaintenance(): void {
  const now = new Date()
  const next3am = new Date(now)
  next3am.setHours(3, 0, 0, 0)
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1)
  const delay = next3am.getTime() - now.getTime()

  maintenanceTimer = setTimeout(() => {
    try { dailyMaintenance() } catch { /* ignore */ }
    maintenanceTimer = setInterval(() => {
      try { dailyMaintenance() } catch { /* ignore */ }
    }, 86400000) as unknown as ReturnType<typeof setTimeout>
  }, delay)
}

/** 每日 23:00 跑完整管道（摘要 + 提取 + 维护）。周日改用 weekly 管道追加影子自动化。 */
function scheduleDailyPipeline(): void {
  if (pipelineTimer) { clearTimeout(pipelineTimer); pipelineTimer = null }
  const now = new Date()
  const next = new Date(now)
  next.setHours(23, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delay = next.getTime() - now.getTime()

  const fire = () => {
    const isSunday = new Date().getDay() === 0
    const p = isSunday ? runWeeklyPipeline() : runDailyPipeline()
    p.catch(e => console.error('[HabitService] scheduled pipeline failed:', (e as Error).message))
  }

  pipelineTimer = setTimeout(() => {
    fire()
    pipelineTimer = setInterval(fire, 86400000) as unknown as ReturnType<typeof setTimeout>
  }, delay)
  console.log('[HabitService] daily pipeline scheduled, first run in', Math.round(delay / 60000), 'min')
}
