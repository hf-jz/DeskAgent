/**
 * Habit Store — SQLite 持久化层
 *
 * 五张表按设计文档 schema：
 *   events     — 原始采样，30 天滚动删除
 *   segments   — 去抖活动段，90 天
 *   summaries  — 每日/每周摘要，永久
 *   habits     — 习惯卡，直至归档
 *   suggestions— 建议，按创建时间保留
 */
import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { encrypt, decrypt } from './crypto'
import { localDateStr } from './util'
import type {
  RawEvent, ActivitySegment, DailySummary,
  HabitCard, HabitStatus, Suggestion,
} from './types'

let db: Database.Database | null = null

// ── Init ──

export function initHabitStore(dataDir: string): void {
  const dbPath = join(dataDir, 'habit.db')
  db = new Database(dbPath)

  // WAL mode for concurrent reads during collection
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  createSchema()
  runRetention()
  console.log('[HabitStore] initialized at', dbPath)
}

export function closeHabitStore(): void {
  if (db) { db.close(); db = null }
}
export function isReady(): boolean { return db !== null }

// ── Schema ──

function createSchema(): void {
  db!.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      kind      TEXT NOT NULL,
      app       TEXT NOT NULL DEFAULT '',
      title     TEXT NOT NULL DEFAULT '',
      url       TEXT DEFAULT '',
      duration  INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

    CREATE TABLE IF NOT EXISTS segments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts    INTEGER NOT NULL,
      end_ts      INTEGER NOT NULL,
      app         TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL DEFAULT '',
      url         TEXT DEFAULT '',
      duration_ms INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_segments_ts ON segments(start_ts);

    CREATE TABLE IF NOT EXISTS summaries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      period     TEXT NOT NULL DEFAULT 'daily',
      text       TEXT NOT NULL DEFAULT '',
      habit_refs TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(date);

    CREATE TABLE IF NOT EXISTS habits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      kind           TEXT NOT NULL,
      trigger_json   TEXT NOT NULL DEFAULT '{}',
      pattern_json   TEXT NOT NULL DEFAULT '{}',
      confidence     REAL NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      first_seen     TEXT NOT NULL DEFAULT '',
      last_seen      TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'candidate',
      user_note      TEXT NOT NULL DEFAULT '',
      created_at     INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at     INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_habits_status ON habits(status);

    CREATE TABLE IF NOT EXISTS suggestions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id   INTEGER,
      kind       TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
  `)
}

// ── Events CRUD ──

export function insertEvent(e: RawEvent): number {
  const stmt = db!.prepare(
    'INSERT INTO events (ts, kind, app, title, url, duration) VALUES (?, ?, ?, ?, ?, ?)'
  )
  return Number(stmt.run(
    e.ts, e.kind, e.app,
    encrypt(e.title),
    encrypt(e.url || ''),
    e.duration || 0,
  ).lastInsertRowid)
}

export function insertEvents(events: RawEvent[]): void {
  const stmt = db!.prepare(
    'INSERT INTO events (ts, kind, app, title, url, duration) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const tx = db!.transaction((items: RawEvent[]) => {
    for (const e of items) stmt.run(
      e.ts, e.kind, e.app,
      encrypt(e.title),
      encrypt(e.url || ''),
      e.duration || 0,
    )
  })
  tx(events)
}

function decryptEvent(e: any): RawEvent {
  return { ...e, title: decrypt(e.title), url: decrypt(e.url || '') }
}

export function getRecentEvents(limit: number = 100): RawEvent[] {
  return (db!.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit) as RawEvent[])
    .map(decryptEvent)
}

export function getEventsSince(ts: number): RawEvent[] {
  return (db!.prepare('SELECT * FROM events WHERE ts >= ? ORDER BY ts ASC').all(ts) as RawEvent[])
    .map(decryptEvent)
}

export function countEvents(): number {
  const row = db!.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
  return row.c
}

// ── Segments CRUD ──

export function insertSegment(s: ActivitySegment): number {
  const stmt = db!.prepare(
    'INSERT INTO segments (start_ts, end_ts, app, title, url, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
  )
  return Number(stmt.run(
    s.startTs, s.endTs, s.app,
    encrypt(s.title),
    encrypt(s.url || ''),
    s.durationMs,
  ).lastInsertRowid)
}

function decryptSegment(s: any): ActivitySegment {
  // SQLite 返回 snake_case 列名，需显式映射为 camelCase（直接 spread 会丢掉 startTs/durationMs）
  return {
    id: s.id,
    startTs: s.start_ts,
    endTs: s.end_ts,
    app: s.app,
    title: decrypt(s.title),
    url: decrypt(s.url || ''),
    durationMs: s.duration_ms,
  }
}

export function getSegmentsForDate(date: string): ActivitySegment[] {
  const start = new Date(date + 'T00:00:00').getTime()
  const end = start + 86400000
  return (db!.prepare(
    'SELECT * FROM segments WHERE start_ts >= ? AND start_ts < ? ORDER BY start_ts ASC'
  ).all(start, end) as ActivitySegment[]).map(decryptSegment)
}

export function countSegments(): number {
  const row = db!.prepare('SELECT COUNT(*) as c FROM segments').get() as { c: number }
  return row.c
}

// ── Summaries CRUD ──

export function insertSummary(s: DailySummary): number {
  const stmt = db!.prepare(
    'INSERT INTO summaries (date, period, text, habit_refs) VALUES (?, ?, ?, ?)'
  )
  return Number(stmt.run(s.date, s.period, s.text, JSON.stringify(s.habitRefs || [])).lastInsertRowid)
}

export function getSummary(date: string, period: 'daily' | 'weekly'): DailySummary | null {
  return db!.prepare(
    'SELECT * FROM summaries WHERE date = ? AND period = ?'
  ).get(date, period) as DailySummary | null
}

export function getRecentSummaries(limit: number = 7): DailySummary[] {
  return db!.prepare(
    'SELECT * FROM summaries ORDER BY date DESC LIMIT ?'
  ).all(limit) as DailySummary[]
}

/** 删除指定日期+周期的摘要（周报重生成前去重，避免同一周堆积多份） */
export function deleteSummary(date: string, period: 'daily' | 'weekly'): void {
  db!.prepare('DELETE FROM summaries WHERE date = ? AND period = ?').run(date, period)
}

// ── Habits CRUD ──

export function insertHabit(h: HabitCard): number {
  const stmt = db!.prepare(
    `INSERT INTO habits (name, kind, trigger_json, pattern_json, confidence,
       evidence_count, first_seen, last_seen, status, user_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  return Number(stmt.run(
    h.name, h.kind, h.triggerJson, h.patternJson,
    h.confidence, h.evidenceCount, h.firstSeen, h.lastSeen,
    h.status, h.userNote,
  ).lastInsertRowid)
}

// HabitCard 字段名（camelCase）→ habits 表列名（snake_case）白名单映射。
// 之前直接拿 camelCase 键拼 SQL，传 evidenceCount/lastSeen 时
// better-sqlite3 抛 "no such column" —— 证据更新路径整体崩溃。
const HABIT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  triggerJson: 'trigger_json',
  patternJson: 'pattern_json',
  confidence: 'confidence',
  evidenceCount: 'evidence_count',
  firstSeen: 'first_seen',
  lastSeen: 'last_seen',
  status: 'status',
  userNote: 'user_note',
}

export function updateHabit(id: number, patch: Partial<HabitCard>): void {
  const sets: string[] = []
  const vals: any[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const col = HABIT_COLUMN_MAP[k]
    if (!col) {
      console.warn('[HabitStore] updateHabit: unknown field ignored:', k)
      continue
    }
    sets.push(`${col} = ?`)
    vals.push(k === 'confidence' || k === 'evidenceCount' ? Number(v) : String(v))
  }
  if (sets.length === 0) return
  sets.push("updated_at = ?")
  vals.push(Date.now())
  vals.push(id)
  db!.prepare(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function getAllHabits(): HabitCard[] {
  return db!.prepare('SELECT * FROM habits ORDER BY updated_at DESC').all() as HabitCard[]
}

export function getHabitsByStatus(status: HabitStatus): HabitCard[] {
  return db!.prepare('SELECT * FROM habits WHERE status = ? ORDER BY confidence DESC').all(status) as HabitCard[]
}

// ── Suggestions CRUD ──

export function insertSuggestion(s: Suggestion): number {
  const stmt = db!.prepare(
    'INSERT INTO suggestions (habit_id, kind, payload, status) VALUES (?, ?, ?, ?)'
  )
  return Number(stmt.run(s.habitId, s.kind, s.payload, s.status).lastInsertRowid)
}

export function getPendingSuggestions(): Suggestion[] {
  return db!.prepare('SELECT * FROM suggestions WHERE status = ?').all('pending') as Suggestion[]
}

// ── Retention ──

const EVENT_RETENTION_DAYS = 30
const SEGMENT_RETENTION_DAYS = 90

function runRetention(): void {
  const now = Date.now()
  const eventCutoff = now - EVENT_RETENTION_DAYS * 86400000
  const segmentCutoff = now - SEGMENT_RETENTION_DAYS * 86400000
  db!.prepare('DELETE FROM events WHERE ts < ?').run(eventCutoff)
  db!.prepare('DELETE FROM segments WHERE start_ts < ?').run(segmentCutoff)
}

/** 每日调一次：cleanup + WAL checkpoint + 自动归档陈旧习惯 */
export function dailyMaintenance(): void {
  runRetention()
  archiveStaleHabits()
  try { db!.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
}

/** 自动归档：30 天未出现的习惯 → stale，60 天 → archived（本地时区日期） */
export function archiveStaleHabits(): void {
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - 30)
  const staleStr = localDateStr(staleDate)
  const archiveDate = new Date()
  archiveDate.setDate(archiveDate.getDate() - 60)
  const archiveStr = localDateStr(archiveDate)

  db!.prepare(
    "UPDATE habits SET status = 'stale', updated_at = ? WHERE status IN ('active','confirmed') AND last_seen < ?"
  ).run(Date.now(), staleStr)

  db!.prepare(
    "UPDATE habits SET status = 'archived', updated_at = ? WHERE status = 'stale' AND last_seen < ?"
  ).run(Date.now(), archiveStr)
}

/** 导出全部习惯数据为 JSON（用于用户导出/备份） */
export function exportAllData(): string {
  const data = {
    exportedAt: new Date().toISOString(),
    counts: {
      events: countEvents(),
      segments: countSegments(),
      habits: getAllHabits().length,
    },
    habits: getAllHabits().map(h => ({ ...h, triggerJson: '', patternJson: '' })), // 不导出敏感 JSON
    summaries: getRecentSummaries(30),
  }
  return JSON.stringify(data, null, 2)
}

/** 一键删除全部习惯数据（被遗忘权） */
export function deleteAllData(): void {
  db!.exec(`
    DELETE FROM events;
    DELETE FROM segments;
    DELETE FROM summaries;
    DELETE FROM habits;
    DELETE FROM suggestions;
  `)
  // VACUUM 回收磁盘空间
  try { db!.exec('VACUUM') } catch { /* ignore */ }
}

/** 获取某日的事件列表（用于摘要）——与 getRecentEvents 一样必须解密 */
export function getEventsForDate(date: string): RawEvent[] {
  const start = new Date(date + 'T00:00:00').getTime()
  const end = start + 86400000
  return (db!.prepare(
    'SELECT * FROM events WHERE ts >= ? AND ts < ? ORDER BY ts ASC'
  ).all(start, end) as RawEvent[]).map(decryptEvent)
}

/** 获取某日事件总数（用于统计） */
export function countEventsForDate(date: string): number {
  const start = new Date(date + 'T00:00:00').getTime()
  const end = start + 86400000
  const r = db!.prepare(
    'SELECT COUNT(*) as cnt FROM events WHERE ts >= ? AND ts < ?'
  ).get(start, end) as any
  return r?.cnt ?? 0
}

/**
 * B9: 黑名单命中回溯清除——删除某 app 最近 sinceTs 以来的全部事件。
 * 场景：30s 才采一次 URL，用户在间隙打开网银页面，
 * 5s 级窗口事件已落库（标题含"网银"等）→ 命中后立即回抹。
 * 按 app+时间删（title 已加密无法匹配），宁可多删不可泄露。
 */
export function deleteEventsForAppSince(app: string, sinceTs: number): number {
  const r = db!.prepare(
    'DELETE FROM events WHERE app = ? AND ts >= ?'
  ).run(app, sinceTs)
  return Number(r.changes) || 0
}

/** 懂你指数统计（D）：观察天数 / 摘要数 / 习惯卡状态分布 */
export function getHabitStats(): {
  daysObserved: number
  summaryCount: number
  confirmedCount: number
  activeCount: number
  avgConfidence: number
} {
  const days = db!.prepare(
    "SELECT COUNT(DISTINCT date(start_ts / 1000, 'unixepoch', 'localtime')) as c FROM segments"
  ).get() as any
  const sums = db!.prepare(
    "SELECT COUNT(*) as c FROM summaries WHERE period = 'daily'"
  ).get() as any
  const habits = db!.prepare(
    "SELECT status, COUNT(*) as c, AVG(confidence) as avgConf FROM habits WHERE status IN ('confirmed','active') GROUP BY status"
  ).all() as any[]
  let confirmed = 0, active = 0, confSum = 0, confN = 0
  for (const row of habits) {
    if (row.status === 'confirmed') confirmed = row.c
    if (row.status === 'active') active = row.c
    if (row.avgConf != null) { confSum += row.avgConf * row.c; confN += row.c }
  }
  return {
    daysObserved: days?.c ?? 0,
    summaryCount: sums?.c ?? 0,
    confirmedCount: confirmed,
    activeCount: active,
    avgConfidence: confN > 0 ? confSum / confN : 0,
  }
}
