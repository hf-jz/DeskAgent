// ── Habit Engineering · 习惯工程 ──
// 数据模型与类型定义
// Phase 0: 地基 — 原始事件采集 + 活动段合并

/** 单次观察采样（events 表） */
export interface RawEvent {
  id?: number
  ts: number            // Unix ms
  kind: 'window' | 'browser_url' | 'deskapp_session'
  app: string           // 应用名，如 "Google Chrome"
  title: string         // 窗口标题 / URL
  url?: string          // 浏览器 URL（kind=browser_url 时）
  duration?: number     // ms，与上次同 app 事件的间隔
}

/** 去抖合并后的活动段（segments 表） */
export interface ActivitySegment {
  id?: number
  startTs: number
  endTs: number
  app: string
  title: string         // 该段内最常见的标题
  url?: string
  durationMs: number
}

/** 每日/每周摘要（summaries 表） */
export interface DailySummary {
  id?: number
  date: string          // "2026-07-24"
  period: 'daily' | 'weekly'
  text: string
  habitRefs: string[]   // 引用的习惯卡 id
  createdAt?: number
}

/** 习惯卡类型 */
export type HabitKind = 'time_routine' | 'sequence' | 'context' | 'preference' | 'workflow'

/** 习惯卡状态 */
export type HabitStatus = 'candidate' | 'confirmed' | 'active' | 'stale' | 'archived'

/** 习惯卡（habits 表） */
export interface HabitCard {
  id?: number
  name: string
  kind: HabitKind
  triggerJson: string   // JSON: { time_range?, days?, app? }
  patternJson: string   // JSON: { apps?, urls?, sequence? }
  confidence: number
  evidenceCount: number
  firstSeen: string     // "2026-07-01"
  lastSeen: string
  status: HabitStatus
  userNote: string
  createdAt?: number
  updatedAt?: number
}

/** 主动建议（suggestions 表） */
export interface Suggestion {
  id?: number
  habitId: number | null
  kind: 'routine' | 'automation' | 'reminder' | 'briefing_item'
  payload: string       // JSON
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  createdAt?: number
}

/** 采集器状态 */
export type CollectorState = 'idle' | 'running' | 'paused' | 'error'

/** 习惯服务总状态 */
export interface HabitServiceState {
  collector: CollectorState
  eventCount: number
  segmentCount: number
  lastSampleAt: number | null
  privacyPaused: boolean
  /** B11: 是否已获知情同意（未授权时采集器不启动） */
  habitEnabled: boolean
  /** AI 摘要开关（opt-in） */
  aiSummaryEnabled: boolean
  /** 采集器累计错误数（权限失败诊断） */
  collectorErrors: number
  lastCollectorError: string
}
