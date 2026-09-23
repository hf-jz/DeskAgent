// ── Inbox — Human attention queue (P0-5) ──
//
// Based on openworker's inbox.py pattern:
//   - Persistent, idempotent, first-responder-wins items
//   - Dual visibility: inline (within bubble) vs inbox (pet badge)
//   - Item types: approval, tree-failed, budget-warning, agent-offline, habit-reminder
//   - SQLite-backed (reuses sessions.db via shared connection)
//
// Design invariants:
//   - (session_id, kind, tool_call_id) is the idempotency key
//   - resolve() is CAS: status='open' → 'resolved', only one responder wins
//   - unattended mode (>10min no user action) routes items to inbox instead of inline

let DB: any = null

// ── Types ──

export type InboxItemKind =
  | 'approval'       // tool-call needs user approval (P0-4B or future)
  | 'tree-failed'    // orchestrator tree node failure
  | 'budget-warning'   // 80% or 100% daily budget
  | 'agent-offline'  // active agent process died
  | 'habit-reminder' // habit engine reminder card

export type InboxVisibility = 'inline' | 'inbox'

export interface InboxItem {
  id: string
  kind: InboxItemKind
  title: string
  preview: string
  status: 'open' | 'resolved'
  sessionId?: string
  toolCallId?: string   // for idempotency dedup
  visibility: InboxVisibility
  createdAt: number
  resolvedBy?: string    // 'user-click' | 'auto-timeout' | 'user-dismiss'
  resolvedAt?: number
  /** Optional payload — extra data the consumer needs (e.g. tool name/args for approval) */
  data?: any
}

// ── Init ──

export function initInboxStore(dbPath: string): void {
  try {
    const Database = require('better-sqlite3')
    DB = new Database(dbPath)
    DB.pragma('journal_mode = WAL')
    DB.pragma('busy_timeout = 3000')
    DB.exec(`
      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT DEFAULT '',
        preview TEXT DEFAULT '',
        status TEXT DEFAULT 'open',
        session_id TEXT DEFAULT '',
        tool_call_id TEXT DEFAULT '',
        visibility TEXT DEFAULT 'inline',
        created_at INTEGER NOT NULL,
        resolved_by TEXT DEFAULT '',
        resolved_at INTEGER DEFAULT 0,
        data TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_items(status, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_dedup
        ON inbox_items(session_id, kind, tool_call_id)
        WHERE status = 'open';
    `)
  } catch {
    console.log('[DeskApp] Inbox: better-sqlite3 unavailable, inbox disabled')
  }
}

// ── Change listeners (pet badge / bubble panel refresh) ──

type InboxListener = (openCount: number) => void
const listeners = new Set<InboxListener>()

export function onInboxChange(fn: InboxListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notifyChange(): void {
  const c = openCount()
  for (const fn of listeners) {
    try { fn(c) } catch { /* listener error must not break producers */ }
  }
}

// ── Idempotent add ──
// Dedup key = (sessionId, kind, toolCallId). If an open item with the same
// key already exists, the new one is silently dropped.

export function addItem(item: {
  kind: InboxItemKind
  title: string
  preview?: string
  sessionId?: string
  toolCallId?: string
  visibility?: InboxVisibility
  data?: any
}): InboxItem | null {
  if (!DB) return null

  const dedupKey = `${item.sessionId || ''}:${item.kind}:${item.toolCallId || ''}`
  const id = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()

  try {
    DB.prepare(`
      INSERT INTO inbox_items (id, kind, title, preview, status, session_id,
        tool_call_id, visibility, created_at, data)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, kind, tool_call_id) WHERE status = 'open' DO NOTHING
    `).run(
      id, item.kind, item.title, (item.preview || '').slice(0, 200),
      item.sessionId || '', item.toolCallId || '',
      item.visibility || 'inbox', now,
      JSON.stringify(item.data || {}),
    )

    // Check if actually inserted
    const row = DB.prepare(`SELECT id FROM inbox_items WHERE id = ?`).get(id)
    if (!row) return null // deduped

    notifyChange()
    return {
      id, kind: item.kind, title: item.title,
      preview: item.preview || '', status: 'open',
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      visibility: item.visibility || 'inbox',
      createdAt: now,
      data: item.data,
    }
  } catch {
    return null
  }
}

// ── List open items ──

export function listOpen(limit = 50): InboxItem[] {
  if (!DB) return []
  try {
    const rows = DB.prepare(`
      SELECT * FROM inbox_items
      WHERE status = 'open'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit)
    return rows.map(rowToItem)
  } catch { return [] }
}

// ── Count (for pet badge) ──

export function openCount(): number {
  if (!DB) return 0
  try {
    const row = DB.prepare(`SELECT COUNT(*) as c FROM inbox_items WHERE status = 'open'`).get() as any
    return row?.c || 0
  } catch { return 0 }
}

// ── Resolve (CAS: first-responder-wins) ──

export function resolveItem(
  id: string,
  resolvedBy: 'user-click' | 'auto-timeout' | 'user-dismiss' = 'user-click',
): boolean {
  if (!DB) return false
  try {
    const result = DB.prepare(`
      UPDATE inbox_items SET status = 'resolved', resolved_by = ?, resolved_at = ?
      WHERE id = ? AND status = 'open'
    `).run(resolvedBy, Date.now(), id)
    if (result.changes > 0) { notifyChange(); return true }
    return false
  } catch { return false }
}

// ── Resolve all of a kind ──

export function resolveKind(kind: InboxItemKind, sessionId?: string): number {
  if (!DB) return 0
  try {
    let sql = `UPDATE inbox_items SET status = 'resolved', resolved_by = 'auto-timeout', resolved_at = ? WHERE kind = ? AND status = 'open'`
    const params: any[] = [Date.now(), kind]
    if (sessionId) {
      sql += ` AND session_id = ?`
      params.push(sessionId)
    }
    const result = DB.prepare(sql).run(...params)
    if (result.changes > 0) notifyChange()
    return result.changes
  } catch { return 0 }
}

// ── Unattended mode ──

let lastUserAction = Date.now()
const UNATTENDED_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

export function touchUserAction(): void {
  lastUserAction = Date.now()
}

export function isUnattended(): boolean {
  return Date.now() - lastUserAction > UNATTENDED_THRESHOLD_MS
}

// ── Inline → Inbox routing ──
// When unattended, items that would normally show inline reroute to inbox.

export function visibilityForItem(forceInbox?: boolean): InboxVisibility {
  if (forceInbox || isUnattended()) return 'inbox'
  return 'inline'
}

// ── Helpers ──

function rowToItem(r: any): InboxItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title || '',
    preview: r.preview || '',
    status: r.status,
    sessionId: r.session_id || '',
    toolCallId: r.tool_call_id || '',
    visibility: r.visibility || 'inbox',
    createdAt: r.created_at || 0,
    resolvedBy: r.resolved_by || '',
    resolvedAt: r.resolved_at || 0,
    data: safeParse(r.data),
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return {} }
}
