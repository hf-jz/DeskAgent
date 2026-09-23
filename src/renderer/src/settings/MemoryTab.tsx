import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

interface MemoryEntry {
  id: number
  scope: 'global' | 'workspace' | 'session'
  workspace: string
  sessionId: string
  key: string
  value: string
  updatedAt: number
}

function SCOPE_META(): Record<string, { label: string; color: string }> {
  return {
    global:    { label: t('mem.global'),   color: 'var(--accent-text)' },
    workspace: { label: t('mem.workspace'), color: 'var(--info)' },
    session:   { label: t('mem.session'),   color: 'var(--ok-text)' },
  }
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elev)', borderRadius: '10px',
  border: '1px solid var(--bg-hover)',
  padding: '16px', marginBottom: '12px',
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: 'var(--line)',
  border: '1px solid var(--solid)', borderRadius: '6px',
  padding: '6px 10px', fontSize: '12px', color: 'var(--ink)', outline: 'none',
}

export default function MemoryTab(): React.JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newScope, setNewScope] = useState<string>('global')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const refresh = (): void => {
    window.deskAppAPI.listMemory().then((list: MemoryEntry[]) => {
      setEntries(Array.isArray(list) ? list : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(refresh, [])

  const add = (): void => {
    const value = newValue.trim()
    if (!value) return
    window.deskAppAPI.addMemory(newScope, value, newKey.trim() || undefined)
      .then(() => { setNewValue(''); setNewKey(''); refresh() }).catch(() => {})
  }

  const saveEdit = (id: number): void => {
    const value = editValue.trim()
    if (!value) return
    window.deskAppAPI.updateMemory(id, value)
      .then(() => { setEditId(null); refresh() }).catch(() => {})
  }

  if (loading) {
    return <div style={{ color: 'var(--ink-muted)', padding: '20px' }}>Loading...</div>
  }

  const groups = (['global', 'workspace', 'session'] as const)
    .map(scope => ({ scope, items: entries.filter(e => e.scope === scope) }))

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Memory</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '20px' }}>
        {t('mem.desc')}
      </p>

      {groups.map(({ scope, items }) => (
        <div key={scope} style={cardStyle}>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px', color: SCOPE_META()[scope].color }}>
            {SCOPE_META()[scope].label} <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>({items.length})</span>
          </label>
          {items.length === 0 && (
            <div style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{t('mem.empty')}</div>
          )}
          {items.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
              <span style={{ fontSize: '10px', color: 'var(--ink-faint)', minWidth: '32px' }}>#{m.id}</span>
              {editId === m.id ? (
                <>
                  <input value={editValue} onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(m.id); if (e.key === 'Escape') setEditId(null) }}
                    autoFocus style={inputStyle} />
                  <button onClick={() => saveEdit(m.id)} style={{ background: 'none', border: 'none', color: 'var(--ok-text)', cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }}>✓</button>
                </>
              ) : (
                <>
                  <code onClick={() => { setEditId(m.id); setEditValue(m.value) }} title={t('mem.edit')} style={{
                    flex: 1, background: 'var(--bg-card)', borderRadius: '6px',
                    padding: '5px 8px', fontSize: '11px', color: 'var(--ink)', cursor: 'text',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{m.key ? `[${m.key}] ` : ''}{m.value}</code>
                  <select value={m.scope} onChange={e => window.deskAppAPI.moveMemory(m.id, e.target.value).then(refresh).catch(() => {})}
                    style={{ background: 'var(--line)', border: '1px solid var(--solid)', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', color: 'var(--ink)', outline: 'none' }}>
                    {Object.entries(SCOPE_META()).map(([s, meta]) => (
                      <option key={s} value={s} style={{ background: 'var(--bg-elev)' }}>{meta.label}</option>
                    ))}
                  </select>
                </>
              )}
              <button onClick={() => window.deskAppAPI.forgetMemory(m.id).then(refresh).catch(() => {})}
                style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }}>✕</button>
            </div>
          ))}
        </div>
      ))}

      <div style={cardStyle}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>➕ 新增记忆</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <select value={newScope} onChange={e => setNewScope(e.target.value)}
            style={{ background: 'var(--line)', border: '1px solid var(--solid)', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: 'var(--ink)', outline: 'none' }}>
            <option value="global" style={{ background: 'var(--bg-elev)' }}>{t('mem.global')}</option>
            <option value="workspace" style={{ background: 'var(--bg-elev)' }}>{t('mem.curWs')}</option>
          </select>
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder={t('mem.keyPh')}
            style={{ ...inputStyle, flex: '0 0 180px' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder={t('mem.valuePh')}
            onKeyDown={e => { if (e.key === 'Enter') add() }} style={inputStyle} />
          <button onClick={add} style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', border: 'none',
            borderRadius: '6px', padding: '6px 14px', color: 'var(--ink)', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer',
          }}>{t('mem.add')}</button>
        </div>
      </div>
    </div>
  )
}
