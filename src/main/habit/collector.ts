/**
 * 感知层采集器 — 前台应用 + 浏览器 URL 采样
 *
 * 采样策略：
 *  - 前台窗口：5s 轮询 active-win，同 app+title 合并时长
 *  - 浏览器 URL：30s 一次 AppleScript（减少性能开销）
 *  - 黑名单（密码管理器/银行/隐身窗口/中文敏感词）命中即丢弃 + 回溯清除（B9）
 *  - 锁屏/无窗口时先结算当前段，时间不跨锁屏桥接（C15）
 *  - 采样重入防护（C20）+ 支持暂停/恢复（隐私开关）
 */
import { execFile } from 'child_process'
import activeWin = require('active-win')
import type { RawEvent, ActivitySegment } from './types'
import { insertEvent, insertSegment, deleteEventsForAppSince } from './store'
import { sanitize } from './privacy'

// ── 黑名单 ──

const BLACKLIST_APPS = new Set([
  '1Password', '1Password 7', '1Password 8',
  'Keychain Access', 'Bitwarden', 'Enpass',
  'loginwindow', // C15: 锁屏界面本身不入库
])

const BLACKLIST_TITLE_PATTERNS = [
  /Incognito/i, /Private Browsing/i, /隐私模式/,
  /InPrivate/i, /Guest/i,
  // B9: 中文敏感场景——命中即整个事件丢弃，比脱敏更保险
  /网银|网上银行|手机银行|银行登录|信用卡/,
  /支付宝|微信支付|云闪付/,
  /医保|社保卡|病历|体检报告/,
  /密码管理|密钥管理|身份验证器/,
]

const BLACKLIST_URL_PATTERNS = [
  /:\/\/.*\.?1password\./i,
  /bank|icbc|ccb|abchina|boc\.cn|cmbchina|spdb|paypal|alipay|unionpay/i,
  /95588|95555|95533|95599|95566/, // 五大行短号出现在 URL 的场景
]

function isBlacklisted(app: string, title: string, url?: string): boolean {
  if (BLACKLIST_APPS.has(app)) return true
  for (const p of BLACKLIST_TITLE_PATTERNS) {
    if (p.test(title)) return true
  }
  if (url) {
    for (const p of BLACKLIST_URL_PATTERNS) {
      if (p.test(url)) return true
    }
  }
  return false
}

// ── 浏览器检测 ──

const BROWSER_APPS = new Set([
  'Google Chrome', 'Safari', 'Arc', 'Microsoft Edge',
  'Brave Browser', 'Firefox', 'Google Chrome Canary',
])

function isBrowser(app: string): boolean {
  return BROWSER_APPS.has(app)
}

/** 用 AppleScript 获取当前浏览器标签页 URL */
function getBrowserURL(app: string): Promise<string> {
  return new Promise((resolve) => {
    let script = ''
    if (app === 'Safari') {
      script = 'tell application "Safari" to get URL of current tab of front window'
    } else if (app === 'Google Chrome' || app === 'Google Chrome Canary') {
      script = 'tell application "Google Chrome" to get URL of active tab of front window'
    } else if (app === 'Arc') {
      // Arc is Chromium-based, same API as Chrome
      script = 'tell application "Arc" to get URL of active tab of front window'
    } else if (app === 'Microsoft Edge') {
      script = 'tell application "Microsoft Edge" to get URL of active tab of front window'
    } else {
      resolve('')
      return
    }
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve(''); return }
      resolve((stdout || '').trim())
    })
  })
}

// ── 采集器状态 ──

export interface CollectorState {
  running: boolean
  paused: boolean
  lastSampleAt: number | null
  sampleCount: number
  errorCount: number
  lastError: string
}

// ── 采集器 ──

const SAMPLE_INTERVAL_MS = 5000
const URL_SAMPLE_INTERVAL = 6   // 每 6 次 (30s) 采一次 URL
const PURGE_WINDOW_MS = 60000   // B9: 黑名单命中时回溯清除的窗口

let interval: ReturnType<typeof setInterval> | null = null
let tickCount = 0
let sampling = false // C20: 重入防护——activeWin/AppleScript 可能超过 5s

// 当前正在积累的活动段
let currentSegment: {
  app: string
  title: string
  url: string
  startTs: number
  lastTs: number
} | null = null

export const state: CollectorState = {
  running: false,
  paused: false,
  lastSampleAt: null,
  sampleCount: 0,
  errorCount: 0,
  lastError: '',
}

// ── 公开 API ──

export function startCollector(): void {
  if (state.running) return
  state.running = true
  state.paused = false
  tickCount = 0
  console.log('[HabitCollector] started, interval', SAMPLE_INTERVAL_MS, 'ms')
  // Immediate first sample
  sample()
  interval = setInterval(sample, SAMPLE_INTERVAL_MS)
}

export function stopCollector(): void {
  state.running = false
  if (interval) { clearInterval(interval); interval = null }
  // Flush current segment
  finalizeSegment()
  console.log('[HabitCollector] stopped, samples:', state.sampleCount)
}

export function pauseCollector(): void {
  state.paused = true
  console.log('[HabitCollector] paused')
}

export function resumeCollector(): void {
  state.paused = false
  // Reset current segment on resume to avoid bridging the pause gap
  finalizeSegment()
  console.log('[HabitCollector] resumed')
}

/** 当前前台 app（供习惯上下文/偏离检测使用） */
export function getCurrentApp(): string {
  return currentSegment?.app ?? ''
}

// ── 采样逻辑 ──

async function sample(): Promise<void> {
  if (state.paused || !state.running) return
  if (sampling) return // C20: 上一次采样未完成，跳过本次
  sampling = true

  try {
    const win = await activeWin()
    tickCount++
    state.lastSampleAt = Date.now()

    if (!win) {
      // C15: 锁屏/无窗口 —— 先结算当前段，时长不跨锁屏桥接
      finalizeSegment()
      return
    }

    const app = win.owner.name
    const title = win.title

    // 黑名单检查（app/标题层）：丢弃当前段 + 回溯清除
    if (isBlacklisted(app, title)) {
      dropCurrentSegment()
      purgeRecentEvents(app)
      return
    }

    // 浏览器 URL 采样（降频）
    let url = ''
    if (isBrowser(app) && tickCount % URL_SAMPLE_INTERVAL === 0) {
      url = await getBrowserURL(app)
      // B9: URL 层命中（如网银）——同样丢弃 + 回溯。
      // URL 30s 才采一次，间隙内的 5s 窗口事件靠标题黑名单和这次回溯兜住。
      if (url && isBlacklisted(app, title, url)) {
        dropCurrentSegment()
        purgeRecentEvents(app)
        return
      }
    }

    // ── 隐私脱敏：URL 去参 + 标题清洗 ──
    const clean = sanitize(app, title, url)

    // 记录事件（存储脱敏后的数据）
    const event: RawEvent = {
      ts: Date.now(),
      kind: clean.url ? 'browser_url' : 'window',
      app: clean.app,
      title: clean.title,
      url: clean.url,
      duration: 0,
    }

    // 段合并逻辑：同 app+title → 延长当前段（基于脱敏值比较）
    if (currentSegment && currentSegment.app === clean.app && currentSegment.title === clean.title) {
      currentSegment.lastTs = event.ts
      if (tickCount % 10 === 0) {
        insertEvent(event)
      }
    } else {
      finalizeSegment()
      currentSegment = {
        app: clean.app,
        title: clean.title,
        url: clean.url,
        startTs: event.ts,
        lastTs: event.ts,
      }
      insertEvent(event)
    }

    state.sampleCount++
  } catch (err: any) {
    state.errorCount++
    state.lastError = err.message || String(err)
  } finally {
    sampling = false
  }
}

/** 结束当前活动段，写入 segments 表 */
function finalizeSegment(): void {
  if (!currentSegment) return
  const durationMs = currentSegment.lastTs - currentSegment.startTs
  // 至少 5 秒的段才保留（过滤一闪而过的切换）
  if (durationMs >= 5000) {
    const seg: ActivitySegment = {
      startTs: currentSegment.startTs,
      endTs: currentSegment.lastTs,
      app: currentSegment.app,
      title: currentSegment.title,
      url: currentSegment.url || undefined,
      durationMs,
    }
    insertSegment(seg)
  }
  currentSegment = null
}

/** B9: 黑名单命中——当前段直接丢弃（不结算入库，连时长都不留） */
function dropCurrentSegment(): void {
  currentSegment = null
}

/** B9: 回溯清除该 app 最近 60s 已落库的事件 */
function purgeRecentEvents(app: string): void {
  try {
    const removed = deleteEventsForAppSince(app, Date.now() - PURGE_WINDOW_MS)
    if (removed > 0) {
      console.log('[HabitCollector] blacklist purge:', app, removed, 'events removed')
    }
  } catch { /* store not ready — nothing to purge */ }
}
