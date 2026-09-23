/**
 * Memory Store — three-tier scoped memory for agent context injection.
 *
 * Scopes:
 *   global    — cross-project user preferences / facts
 *   workspace — project-specific conventions / commands
 *   session   — current conversation only (cleared on session end)
 *
 * Injected into the agent context as:
 *   [#id] value
 *
 * Uses better-sqlite3 (same pattern as inbox / session-store). Falls back
 * silently when the native module is unavailable (no crash).
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

// ── Schema & types ──

export type MemoryScope = 'global' | 'workspace' | 'session'

export interface MemoryEntry {
  id: number
  scope: MemoryScope
  workspace: string
  sessionId: string
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

// ── DB singleton ──

let DB: any = null
let DB_PATH = ''

function db(): any {
  if (DB) return DB
  try {
    const Database = require('better-sqlite3')
    const userData = app.getPath('userData')
    DB_PATH = join(userData, 'memory.db')
    const dir = join(DB_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    DB = new Database(DB_PATH)
    DB.pragma('journal_mode = WAL')
    DB.pragma('busy_timeout = 3000')
    DB.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        scope      TEXT NOT NULL CHECK(scope IN ('global','workspace','session')),
        workspace  TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        key        TEXT NOT NULL DEFAULT '',
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope, workspace, session_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_key ON memory(scope, workspace, session_id, key)
        WHERE key != '';
    `)
    console.log('[DeskApp] Memory store: initialized at', DB_PATH)
    return DB
  } catch (e) {
    console.log('[DeskApp] Memory store: better-sqlite3 unavailable, memory disabled')
    return null
  }
}

// ── CRUD ──

/** Store or update a memory entry. If key is provided and an entry with the
 *  same (scope, workspace, sessionId, key) exists, it is updated in-place.
 *  Otherwise a new row is inserted. Returns the entry id. */
export function remember(
  scope: MemoryScope,
  value: string,
  opts?: { key?: string; workspace?: string; sessionId?: string },
): number | null {
  const d = db()
  if (!d) return null
  const now = Date.now()
  const ws = opts?.workspace || ''
  const sid = opts?.sessionId || ''
  const k = opts?.key || ''

  try {
    // When a key is given, check for exact duplicate first
    if (k) {
      const existing = d.prepare(
        'SELECT id FROM memory WHERE scope=? AND workspace=? AND session_id=? AND key=?',
      ).get(scope, ws, sid, k) as { id: number } | undefined
      if (existing) {
        d.prepare('UPDATE memory SET value=?, updated_at=? WHERE id=?').run(value, now, existing.id)
        return existing.id
      }
    }

    // Check for approximate duplicate (80% prefix overlap on value)
    // Only within same scope + workspace (not session — session is transient)
    if (scope !== 'session') {
      const prefix = value.slice(0, Math.floor(value.length * 0.8))
      if (prefix.length > 20) {
        const similar = d.prepare(
          'SELECT id FROM memory WHERE scope=? AND workspace=? AND value LIKE ? LIMIT 1',
        ).get(scope, ws, prefix + '%') as { id: number } | undefined
        if (similar) {
          d.prepare('UPDATE memory SET value=?, key=COALESCE(NULLIF(?, \'\'), key), updated_at=? WHERE id=?')
            .run(value, k, now, similar.id)
          return similar.id
        }
      }
    }

    // Insert new
    const result = d.prepare(
      'INSERT INTO memory (scope, workspace, session_id, key, value, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(scope, ws, sid, k, value, now, now)
    return Number(result.lastInsertRowid)
  } catch (e) {
    console.error('[DeskApp] Memory store: remember failed:', (e as Error).message)
    return null
  }
}

/** Query memories by scope. workspace and sessionId narrow the results. */
export function recall(
  scope: MemoryScope,
  workspace?: string,
  sessionId?: string,
): MemoryEntry[] {
  const d = db()
  if (!d) return []
  try {
    let sql = 'SELECT * FROM memory WHERE scope=?'
    const params: any[] = [scope]
    if (workspace !== undefined) {
      sql += ' AND workspace=?'
      params.push(workspace)
    }
    if (sessionId !== undefined) {
      sql += ' AND session_id=?'
      params.push(sessionId)
    }
    sql += ' ORDER BY updated_at DESC LIMIT 50'
    return d.prepare(sql).all(...params) as MemoryEntry[]
  } catch {
    return []
  }
}

/** Update a specific memory entry by id. */
export function updateMemory(id: number, value: string): boolean {
  const d = db()
  if (!d) return false
  try {
    const result = d.prepare('UPDATE memory SET value=?, updated_at=? WHERE id=?')
      .run(value, Date.now(), id)
    return result.changes > 0
  } catch {
    return false
  }
}

/** Delete a memory entry by id. */
export function forget(id: number): boolean {
  const d = db()
  if (!d) return false
  try {
    const result = d.prepare('DELETE FROM memory WHERE id=?').run(id)
    return result.changes > 0
  } catch {
    return false
  }
}

/** Move a memory entry to a different scope. */
export function moveMemory(id: number, newScope: MemoryScope): boolean {
  const d = db()
  if (!d) return false
  try {
    const result = d.prepare('UPDATE memory SET scope=?, updated_at=? WHERE id=?')
      .run(newScope, Date.now(), id)
    return result.changes > 0
  } catch {
    return false
  }
}

/** List all memories (for settings UI). */
export function listAll(): MemoryEntry[] {
  const d = db()
  if (!d) return []
  try {
    return d.prepare('SELECT * FROM memory ORDER BY scope, updated_at DESC').all() as MemoryEntry[]
  } catch {
    return []
  }
}

/** Format memories for agent context injection. */
export function formatForContext(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(e => `[#${e.id}] ${e.value}`)
  lines.push('[记忆规则] 只存持久事实/偏好/无法从代码重推导的上下文；近似重复用 update；过时用 forget')
  return lines.join('\n')
}

/** Clear all session-scoped memories for a given sessionId. */
export function clearSession(sessionId: string): void {
  const d = db()
  if (!d) return
  try {
    d.prepare("DELETE FROM memory WHERE scope='session' AND session_id=?").run(sessionId)
  } catch { /* ignore */ }
}
