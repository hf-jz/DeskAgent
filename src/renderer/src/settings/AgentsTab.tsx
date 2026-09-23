import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

interface AgentInfo {
  id: string; name: string; publisher: string; version?: string
  status: 'running' | 'installed' | 'not-installed' | 'error'
}

const S = {
  card: (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
    border: active ? '1px solid var(--accent-line)' : '1px solid var(--line)',
    borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '14px',
    transition: 'all 0.15s',
  }),
  icon: (active: boolean): React.CSSProperties => ({
    width: '36px', height: '36px', borderRadius: '9px',
    background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--bg-hover)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', fontWeight: 700, color: 'var(--ink)', flexShrink: 0,
  }),
  dot: (color: string): React.CSSProperties => ({
    width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block',
  }),
  installBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', border: 'none',
    borderRadius: '6px', padding: '6px 16px', color: 'var(--ink)', fontSize: '11px',
    fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties,
  actionBtn: {
    background: 'var(--line)', border: '1px solid var(--solid)',
    borderRadius: '6px', padding: '5px 12px', color: 'var(--ink)', fontSize: '11px',
    fontWeight: 500, cursor: 'pointer',
  } as React.CSSProperties,
  refreshBtn: {
    background: 'transparent', border: '1px solid var(--solid)',
    borderRadius: '6px', padding: '5px 10px', color: 'var(--ink-muted)',
    fontSize: '11px', cursor: 'pointer', marginLeft: '8px',
  } as React.CSSProperties,
  err: {
    background: 'var(--danger-soft)', border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '8px', padding: '8px 12px', marginBottom: '16px', fontSize: '12px',
    color: 'var(--danger-text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  } as React.CSSProperties,
  ok: {
    background: 'var(--ok-soft)', border: '1px solid rgba(52,199,89,0.25)',
    borderRadius: '8px', padding: '8px 12px', marginBottom: '16px', fontSize: '12px',
    color: 'var(--ok)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  } as React.CSSProperties,
}

const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: 'Running', color: 'var(--ok)' },
  installed: { label: 'Installed', color: 'var(--ink-muted)' },
  'not-installed': { label: 'Not Installed', color: 'var(--danger)' },
  error: { label: 'Error', color: 'var(--danger)' },
  installing: { label: 'Installing...', color: 'var(--warn)' },
}

export default function AgentsTab(): React.JSX.Element {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const s = await (window as any).deskAppAPI.scanAgents()
      setAgents(s.agents || [])
      setActiveId(s.activeAgentId || null)
    } catch (e) { console.error(e) }
  }

  const doInstall = async (id: string) => {
    setInstalling(id); setError(''); setOk('')
    try {
      const r = await (window as any).deskAppAPI.installAgent(id)
      if (r.success) { setOk(`${id} installed successfully!`); await load() }
      else setError(r.error || 'Install failed')
    } catch (e: any) { setError(e.message) }
    setInstalling(null)
  }

  const doSetActive = async (id: string | null) => {
    await (window as any).deskAppAPI.setActiveAgent(id)
    await load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{t('settings.tab.agents')}</h2>
        <button style={S.refreshBtn} onClick={load}>🔄 Refresh</button>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '16px' }}>
        One-click install and manage AI agents. Select your default assistant.
      </p>

      {error && <div style={S.err}>{error}<button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--danger-text)', cursor: 'pointer' }}>✕</button></div>}
      {ok && <div style={S.ok}>{ok}<button onClick={() => setOk('')} style={{ background: 'none', border: 'none', color: 'var(--ok)', cursor: 'pointer' }}>✕</button></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {agents.map(a => {
          const st = installing === a.id ? 'installing' : a.status
          const sb = STATUS[st] || STATUS['not-installed']
          const isActive = activeId === a.id
          return (
            <div key={a.id} style={S.card(isActive)}>
              <div style={S.icon(isActive)}>{a.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                  {a.name}
                  {isActive && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--accent-text)' }}>● Active</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                  {a.publisher}{a.version ? ` · v${a.version}` : ''}
                </div>
                <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 500 }}>
                  <span style={S.dot(sb.color)} />{sb.label}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {a.status === 'not-installed' ? (
                  <button style={S.installBtn} onClick={() => doInstall(a.id)} disabled={installing !== null}>
                    {installing === a.id ? '⏳ Installing...' : '⬇ Install'}
                  </button>
                ) : (
                  <button style={S.actionBtn} onClick={() => doSetActive(isActive ? null : a.id)}>
                    {isActive ? 'Deselect' : 'Set Active'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {agents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-muted)', fontSize: '13px' }}>
            No agents detected. Click Refresh to scan again.
          </div>
        )}
      </div>

      <PersonasSection />
    </div>
  )
}

/** P2-C3 #26: persona manifests — one active persona's systemPrefix is
 *  injected into every turn context ([人格设定] block). */
function PersonasSection(): React.JSX.Element {
  const [personas, setPersonas] = useState<{ id: string; name: string; systemPrefix: string }[]>([])
  const [activeId, setActive] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')

  const reload = (): void => {
    window.deskAppAPI.listPersonas().then(r => { setPersonas(r.personas); setActive(r.activeId) }).catch(() => {})
  }
  useEffect(reload, [])

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('agents.personaTitle')}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
        {t('agents.personaDesc')}
      </div>
      {personas.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 4,
          background: 'var(--bg-card)', border: '1px solid var(--bg-hover)', borderRadius: 8, fontSize: 12,
        }}>
          <span style={{ flex: 1, color: p.id === activeId ? 'var(--warn-text)' : 'var(--ink)' }}>
            {p.id === activeId ? '● ' : ''}{p.name}
          </span>
          <button onClick={() => window.deskAppAPI.setActivePersona(p.id === activeId ? null : p.id).then(reload)} style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
            background: p.id === activeId ? 'rgba(251,191,36,0.12)' : 'var(--line)',
            border: `1px solid ${p.id === activeId ? 'rgba(251,191,36,0.4)' : 'var(--solid)'}`,
            color: p.id === activeId ? 'var(--warn-text)' : 'var(--ink-secondary)',
          }}>{p.id === activeId ? t('agents.deactivate') : t('agents.activate')}</button>
          <button onClick={() => window.deskAppAPI.deletePersona(p.id).then(reload)} style={{
            background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 13,
          }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('agents.namePlaceholder')} style={{
          padding: '6px 10px', fontSize: 12, borderRadius: 6,
          background: 'var(--bg-card)', border: '1px solid var(--solid)', color: 'var(--ink)', outline: 'none',
        }} />
        <textarea value={prefix} onChange={e => setPrefix(e.target.value)} placeholder={t('agents.prefixPlaceholder')} rows={3} style={{
          padding: '6px 10px', fontSize: 12, borderRadius: 6, resize: 'vertical', fontFamily: 'inherit',
          background: 'var(--bg-card)', border: '1px solid var(--solid)', color: 'var(--ink)', outline: 'none',
        }} />
        <button onClick={() => {
          if (!name.trim() || !prefix.trim()) return
          window.deskAppAPI.savePersona({ name, systemPrefix: prefix }).then(() => { setName(''); setPrefix(''); reload() })
        }} style={{
          alignSelf: 'flex-start', padding: '5px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
          background: 'var(--info-soft)', border: '1px solid var(--info)', color: 'var(--info)',
        }}>{t('agents.create')}</button>
      </div>
    </div>
  )
}
