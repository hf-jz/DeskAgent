// ── Session Store — SQLite index + JSONL append-only (P0-6) ──
//
// Based on openworker's conversations.py pattern:
//   - SQLite sessions table for indexing/search
//   - Per-session JSONL files for append-only message storage
//   - auto_title independent of manual title
//   - pin/archive don't update updated_at
//
// Uses better-sqlite3 (already in devDependencies). Falls back to
// the old JSON-file store if better-sqlite3 isn't available.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'

let DB: any = null
let SESSION_DIR = ''
let DB_PATH = ''

// ── Path safety ──

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/
export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && SAFE_ID.test(sessionId)
}

// ── Init ──

export function initSessionStore(appDataPath: string): void {
  SESSION_DIR = join(appDataPath, 'sessions')
  mkdirSync(SESSION_DIR, { recursive: true })
  DB_PATH = join(appDataPath, 'sessions.db')

  try {
    const Database = require('better-sqlite3')
    DB = new Database(DB_PATH)
    DB.pragma('journal_mode = WAL')
    DB.pragma('busy_timeout = 3000')
    DB.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        auto_title TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        pinned INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        preview TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned, updated_at DESC);
    `)
    console.log('[DeskApp] Session store: SQLite initialized')
  } catch (e) {
    console.log('[DeskApp] Session store: better-sqlite3 unavailable, falling back to JSON files')
    DB = null
  }
}

// ── CRUD ──

export interface SessionRow {
  id: string
  title: string
  auto_title: string
  created_at: number
  updated_at: number
  pinned: number
  archived: number
  message_count: number
  preview: string
}

export interface SessionEntry {
  id: string
  title: string
  timestamp: number
  messageCount: number
  preview: string
  pinned?: boolean
  archived?: boolean
}

// ── JSONL path ──

function jsonlPath(sessionId: string): string {
  return join(SESSION_DIR, `${sessionId}.jsonl`)
}

// ── Save (append-only JSONL + SQLite index) ──

export function saveSession(sessionId: string, data: any): void {
  if (!SESSION_DIR || !isValidSessionId(sessionId)) return

  const messages = (data && Array.isArray(data.messages)) ? data.messages : []
  const ts = data?.timestamp || Date.now()

  // Append to JSONL — one line per message, entire conversation dumped each time
  // for transition period. After P0-1 event-bus integration, this becomes
  // true per-event append.
  try {
    const jlPath = jsonlPath(sessionId)
    // Write full JSONL (transitional — future: true append)
    const lines = messages.map((m: any) => JSON.stringify({
      ts: m.ts || ts,
      kind: m.kind,
      content: m.content?.slice(0, 8000),
      name: m.name,
      args: m.args,
      model: m.model,
      via: m.via,
    })).join('\n') + '\n'
    writeFileSync(jlPath, lines)
  } catch { /* ignore */ }

  // Update SQLite index
  if (DB) {
    try {
      const preview = messages.length > 0
        ? (messages[messages.length - 1]?.content || '').slice(0, 120)
        : ''
      const autoTitle = messages.length > 0
        ? (messages.find((m: any) => m.kind === 'user')?.content || '').slice(0, 80)
        : ''
      DB.prepare(`
        INSERT INTO sessions (id, title, auto_title, created_at, updated_at, message_count, preview)
        VALUES (?, '', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          auto_title = COALESCE(NULLIF(excluded.auto_title,''), sessions.auto_title),
          updated_at = CASE WHEN sessions.pinned = 0 AND sessions.archived = 0 THEN excluded.updated_at ELSE sessions.updated_at END,
          message_count = excluded.message_count,
          preview = excluded.preview
      `).run(sessionId, autoTitle, ts, ts, messages.length, preview)
    } catch { /* ignore */ }
  }

  // Fallback: write JSON file
  const file = join(SESSION_DIR, `${sessionId}.json`)
  try { writeFileSync(file, JSON.stringify(data, null, 2)) } catch { /* ignore */ }
}

// ── Load ──

export function loadSession(sessionId: string): unknown | null {
  if (!SESSION_DIR || !isValidSessionId(sessionId)) return null

  // Try JSONL first
  const jlPath = jsonlPath(sessionId)
  if (existsSync(jlPath)) {
    try {
      const lines = readFileSync(jlPath, 'utf-8').trim().split('\n').filter(Boolean)
      const messages = lines.map((line, i) => {
        try {
          const parsed = JSON.parse(line)
          return { ...parsed, id: parsed.id || `msg-${Date.now()}-${i}` }
        } catch { return null }
      }).filter(Boolean)
      return { messages, timestamp: Date.now() }
    } catch { /* fall through to JSON */ }
  }

  // Fallback: old JSON file
  const file = join(SESSION_DIR, `${sessionId}.json`)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
}

// ── List sessions ──

export function listSessions(filter?: { pinned?: boolean; archived?: boolean }): SessionEntry[] {
  if (DB) {
    try {
      let sql = `SELECT id, COALESCE(NULLIF(title,''), auto_title, '') as title,
                        created_at, updated_at, message_count, preview,
                        pinned, archived
                 FROM sessions WHERE 1=1`
      const params: any[] = []
      if (filter?.pinned !== undefined) {
        sql += ` AND pinned = ?`
        params.push(filter.pinned ? 1 : 0)
      }
      if (filter?.archived !== undefined) {
        sql += ` AND archived = ?`
        params.push(filter.archived ? 1 : 0)
      }
      sql += ` ORDER BY pinned DESC, updated_at DESC LIMIT 200`

      const rows = DB.prepare(sql).all(...params)
      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        timestamp: r.created_at,
        messageCount: r.message_count,
        preview: (r.preview || '').slice(0, 80),
        pinned: r.pinned === 1,
        archived: r.archived === 1,
      }))
    } catch { /* fall through */ }
  }

  // Fallback: scan JSON files
  try {
    const { readdirSync } = require('fs')
    const files = readdirSync(SESSION_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .sort((a: string, b: string) => {
        // Sort by mtime desc
        const { statSync } = require('fs')
        return statSync(join(SESSION_DIR, b)).mtimeMs - statSync(join(SESSION_DIR, a)).mtimeMs
      })
      .slice(0, 50)

    return files.map((f: string) => {
      const id = f.replace('.json', '')
      try {
        const data = JSON.parse(readFileSync(join(SESSION_DIR, f), 'utf-8'))
        return {
          id,
          title: (data.messages?.[0]?.content || '').slice(0, 40),
          timestamp: data.timestamp || 0,
          messageCount: data.messages?.length || 0,
          preview: (data.messages?.[data.messages.length - 1]?.content || '').slice(0, 80),
        }
      } catch {
        return { id, title: f, timestamp: 0, messageCount: 0, preview: '' }
      }
    })
  } catch {
    return []
  }
}

// ── Mutations (title/pin/archive) ──

export function setSessionTitle(sessionId: string, title: string): void {
  if (!DB || !isValidSessionId(sessionId)) return
  try {
    DB.prepare(`UPDATE sessions SET title = ?, updated_at = updated_at WHERE id = ?`)
      .run(title.slice(0, 200), sessionId)
  } catch { /* ignore */ }
}

export function setSessionFlag(sessionId: string, flag: 'pinned' | 'archived', value: boolean): void {
  if (!DB || !isValidSessionId(sessionId)) return
  try {
    const col = flag === 'pinned' ? 'pinned' : 'archived'
    // Pin/archive don't update updated_at (openworker design)
    DB.prepare(`UPDATE sessions SET ${col} = ?, updated_at = updated_at WHERE id = ?`)
      .run(value ? 1 : 0, sessionId)
  } catch { /* ignore */ }
}

export function deleteSession(sessionId: string): boolean {
  if (!DB || !isValidSessionId(sessionId)) {
    // Fallback: delete JSON file
    try {
      const { unlinkSync } = require('fs')
      unlinkSync(join(SESSION_DIR, `${sessionId}.json`))
      return true
    } catch { return false }
  }
  try {
    DB.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
    // Also delete JSONL
    try { const { unlinkSync } = require('fs'); unlinkSync(jsonlPath(sessionId)) } catch {}
    return true
  } catch { return false }
}

// ── Search ──

export function searchSessions(query: string): SessionEntry[] {
  if (!DB) return []
  try {
    const rows = DB.prepare(`
      SELECT id, COALESCE(NULLIF(title,''), auto_title, '') as title,
             created_at, updated_at, message_count, preview
      FROM sessions
      WHERE title LIKE ? OR auto_title LIKE ? OR preview LIKE ?
      ORDER BY updated_at DESC LIMIT 20
    `).all(`%${query}%`, `%${query}%`, `%${query}%`)
    return rows.map((r: any) => ({
      id: r.id, title: r.title, timestamp: r.created_at,
      messageCount: r.message_count, preview: (r.preview || '').slice(0, 80),
    }))
  } catch { return [] }
}
