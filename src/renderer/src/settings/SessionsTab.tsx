import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'
import type { SessionEntry } from '../../../shared/ipc-channels'

interface Props {
  agentNames?: Record<string, string>
  currentSessionId?: string | null
  onSelect?: (sessionId: string) => void
}

/** P1-B2 #14: session rows — title (manual > auto), pin/archive/rename,
 *  two-click delete, compact time, inbox attention badge. */
export default function SessionsTab({ agentNames, currentSessionId, onSelect }: Props) {
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [attention, setAttention] = useState<Record<string, number>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const refresh = (): void => {
    window.deskAppAPI.listSessions().then(setSessions).catch(() => {})
    window.deskAppAPI.listInbox?.().then(items => {
      const map: Record<string, number> = {}
      for (const it of items) if (it.sessionId) map[it.sessionId] = (map[it.sessionId] || 0) + 1
      setAttention(map)
    }).catch(() => {})
  }
  useEffect(refresh, [])

  const fmtTime = (ts: number): string => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString())
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
  }

  const visible = sessions.filter(s => showArchived ? s.archived : !s.archived)

  const btn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
    color: 'var(--ink-faint)', padding: '2px 4px', flexShrink: 0,
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button onClick={() => setShowArchived(!showArchived)} style={{ ...btn, fontSize: 10, color: 'var(--ink-muted)' }}>
          {showArchived ? t('sessions.backToActive') : t('sessions.archived')}
        </button>
      </div>
      {visible.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, padding: 20 }}>
          {showArchived ? t('sessions.noArchived') : t('sessions.noSessions')}
        </div>
      )}
      {visible.map(s => (
        <div key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', marginBottom: 4,
          borderRadius: 8, cursor: 'pointer',
          background: s.id === currentSessionId ? 'var(--accent-soft)' : 'var(--bg-card)',
          border: `1px solid ${s.id === currentSessionId ? 'var(--accent-line)' : 'var(--line)'}`,
        }} onClick={() => onSelect?.(s.id)}>
          {renaming === s.id ? (
            <input autoFocus value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') { window.deskAppAPI.renameSession(s.id, renameText.trim()).then(refresh); setRenaming(null) }
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={() => setRenaming(null)}
              style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid var(--accent-line)', borderRadius: 4, color: 'var(--ink)', fontSize: 12, padding: '2px 6px', outline: 'none' }} />
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.pinned ? '📌 ' : ''}{s.title || s.preview || s.id}
              </div>
              <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginTop: 2 }}>
                {fmtTime(s.timestamp)} · {t('sessions.msgCount', { n: s.messageCount })}
              </div>
            </div>
          )}
          {(attention[s.id] || 0) > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', background: 'rgba(239,68,68,0.15)', borderRadius: 8, padding: '1px 5px', flexShrink: 0 }}>
              {attention[s.id]}
            </span>
          )}
          <span onClick={e => e.stopPropagation()} style={{ display: 'flex' }}>
            <button title={s.pinned ? t('sessions.unpin') : t('sessions.pin')} style={btn}
              onClick={() => window.deskAppAPI.pinSession(s.id, !s.pinned).then(refresh)}>📌</button>
            <button title={t('sessions.rename')} style={btn}
              onClick={() => { setRenaming(s.id); setRenameText(s.title || '') }}>✏️</button>
            <button title={s.archived ? t('sessions.unarchive') : t('sessions.archive')} style={btn}
              onClick={() => window.deskAppAPI.archiveSession(s.id, !s.archived).then(refresh)}>🗄</button>
            {confirmDelete === s.id ? (
              <button title={t('sessions.confirmDelete')} style={{ ...btn, color: 'var(--danger)' }}
                onClick={() => { window.deskAppAPI.deleteSession(s.id).then(refresh); setConfirmDelete(null) }}>确认</button>
            ) : (
              <button title={t('sessions.delete')} style={btn}
                onClick={() => { setConfirmDelete(s.id); setTimeout(() => setConfirmDelete(c => c === s.id ? null : c), 3000) }}>🗑</button>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
