import { useState, useEffect, useRef } from 'react'
import { t } from '../lib/i18n'
import type { InboxItemInfo } from '../../../shared/ipc-channels'

const KIND_META: Record<InboxItemInfo['kind'], { icon: string; color: string }> = {
  'approval':       { icon: '🔐', color: 'var(--warn)' },
  'tree-failed':    { icon: '🌳', color: 'var(--danger)' },
  'budget-warning': { icon: '💰', color: 'var(--warn)' },
  'agent-offline':  { icon: '🔌', color: 'var(--danger)' },
  'habit-reminder': { icon: '🌱', color: 'var(--ok)' },
}

/**
 * Inbox bell + dropdown panel (P0-5).
 * Shows open-item count; clicking the bell lists items; clicking an item
 * resolves it (first-responder-wins via main-process CAS).
 */
export default function InboxPanel(): React.JSX.Element {
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InboxItemInfo[]>([])
  const [detail, setDetail] = useState<InboxItemInfo | null>(null)
  // #38: Pending/Configure tabs — muted kinds are hidden from Pending
  const [tab, setTab] = useState<'pending' | 'configure'>('pending')
  const [muted, setMuted] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('deskapp.inbox.muted') || '[]') } catch { return [] }
  })
  const rootRef = useRef<HTMLDivElement>(null)

  const toggleMute = (kind: string): void => {
    setMuted(prev => {
      const next = prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
      localStorage.setItem('deskapp.inbox.muted', JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    window.deskAppAPI.getInboxCount?.().then(setCount).catch(() => {})
    const unsub = window.deskAppAPI.onInboxChanged?.((c) => {
      setCount(c)
      // Live-refresh the list while the panel is open
      if (open) window.deskAppAPI.listInbox?.().then(setItems).catch(() => {})
    })
    return () => { unsub?.() }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) window.deskAppAPI.listInbox?.().then(setItems).catch(() => {})
  }

  const resolve = (id: string): void => {
    window.deskAppAPI.resolveInboxItem?.(id, 'user-click').then(() => {
      setItems(prev => prev.filter(i => i.id !== id))
    }).catch(() => {})
  }

  const fmtTime = (ts: number): string => {
    const d = new Date(ts)
    const now = Date.now()
    if (now - ts < 60_000) return t('inbox.justNow')
    if (now - ts < 3_600_000) return t('inbox.minAgo', { n: Math.floor((now - ts) / 60_000) })
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  const btn: React.CSSProperties = {
    border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer',
    background: 'var(--line)', fontFamily: 'inherit',
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' as any }}>
      <div onClick={toggle} style={{
        fontSize: '11px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px',
        background: count > 0 ? 'var(--danger-soft)' : 'var(--line)',
        display: 'flex', alignItems: 'center', gap: '3px', transition: 'all 0.15s',
        color: count > 0 ? 'var(--danger)' : 'var(--ink-muted)',
      }}>
        🔔
        {count > 0 && <span style={{ fontSize: '9px', fontWeight: 700 }}>{count > 99 ? '99+' : count}</span>}
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 60,
          background: 'var(--bg-elev)', border: '1px solid var(--solid)',
          borderRadius: '8px', padding: '6px', width: '280px', marginTop: '4px',
          maxHeight: '320px', overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', gap: 4, padding: '2px 6px 6px' }}>
            {(['pending', 'configure'] as const).map(tabId => (
              <span key={tabId} onClick={() => setTab(tabId)} style={{
                fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.5px',
                color: tab === tabId ? 'var(--ink)' : 'var(--ink-faint)',
                borderBottom: tab === tabId ? '1px solid var(--accent)' : '1px solid transparent', paddingBottom: 2,
              }}>
                {tabId === 'pending' ? t('inbox.pending', { n: count }) : t('inbox.config')}
              </span>
            ))}
          </div>
          {tab === 'configure' && (
            <div style={{ padding: '4px 6px' }}>
              <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginBottom: 6 }}>{t('inbox.muted')}</div>
              {Object.entries(KIND_META).map(([kind, meta]) => (
                <div key={kind} onClick={() => toggleMute(kind)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', cursor: 'pointer', fontSize: 11,
                  color: muted.includes(kind) ? 'var(--ink-faint)' : 'var(--ink-secondary)',
                }}>
                  <span>{meta.icon}</span><span style={{ flex: 1 }}>{kind}</span>
                  <span style={{ fontSize: 10 }}>{muted.includes(kind) ? '🔇' : '🔔'}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'pending' && items.filter(i => !muted.includes(i.kind)).length === 0 && (
            <div style={{ fontSize: '11px', color: 'var(--ink-faint)', padding: '12px 6px', textAlign: 'center' }}>
              {t('inbox.allDone')}
            </div>
          )}
          {tab === 'pending' && items.filter(i => !muted.includes(i.kind)).map(item => {
            const meta = KIND_META[item.kind] || { icon: '📨', color: 'var(--ink-muted)' }
            return (
              <div key={item.id} onClick={() => setDetail(item)} title={t('inbox.viewDetail')} style={{
                padding: '8px', borderRadius: '6px', marginBottom: '4px',
                background: 'var(--bg-card)',
                border: `1px solid ${meta.color}22`,
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink)' }}>
                      {item.title}
                    </div>
                    {item.preview && (
                      <div style={{
                        fontSize: '10px', color: 'var(--ink-muted)', marginTop: '2px',
                        lineHeight: '1.5', wordBreak: 'break-word',
                      }}>
                        {item.preview}
                      </div>
                    )}
                    <div style={{ fontSize: '9px', color: 'var(--ink-faint)', marginTop: '3px' }}>
                      {fmtTime(item.createdAt)}
                    </div>
                  </div>
                  <button onClick={() => resolve(item.id)} style={{
                    background: 'none', border: 'none', color: 'var(--ink-faint)',
                    cursor: 'pointer', fontSize: '12px', padding: '2px 4px', flexShrink: 0,
                  }} title={t('inbox.markDone')}>✓</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail popup — full message */}
      {detail && (
        <div
          onClick={() => setDetail(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(340px, 86vw)', maxHeight: '70vh', overflowY: 'auto',
            background: 'var(--bg-elev)', border: '1px solid var(--solid)', borderRadius: 10,
            padding: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{KIND_META[detail.kind]?.icon || '📨'}</span>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>{detail.title}</div>
              <span onClick={() => setDetail(null)} style={{ cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 13 }}>✕</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--ink-faint)', marginBottom: 8 }}>
              {detail.kind} · {fmtTime(detail.createdAt)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {detail.preview}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
              <button onClick={() => setDetail(null)} style={{ ...btn, color: 'var(--ink-muted)' }}>关闭</button>
              <button onClick={() => { resolve(detail.id); setDetail(null) }} style={{ ...btn, color: '#fff', background: 'var(--accent)' }}>标记已处理</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
