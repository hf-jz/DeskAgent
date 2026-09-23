import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

interface AuditEntry {
  ts: string; event: string; name: string; detail: string
}

export default function ActivityTab(): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [search, setSearch] = useState('')
  // D2 #45: dead-letter ring — unhandled bridge events + IPC throws
  const [dead, setDead] = useState<{ ts: number; kind: string; summary: string; detail?: string }[]>([])
  // Environment self-check (on demand — it shells out to ps/python)
  const [doctor, setDoctor] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail: string; hint?: string }[] } | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)

  useEffect(() => {
    (window as any).deskAppAPI.getAuditLog?.().then((data: any) => {
      if (Array.isArray(data)) setEntries(data.slice(-50).reverse())
      setLoading(false)
    }).catch(() => setLoading(false))
    // Also load agent stats
    ;(window as any).deskAppAPI.getAgentStats?.().then((s: any) => {
      if (s) setStats(s)
    }).catch(() => {})
    ;(window as any).deskAppAPI.listDeadLetters?.().then((d: any) => {
      if (Array.isArray(d)) setDead(d)
    }).catch(() => {})
  }, [])

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Activity</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '16px' }}>
        Recent tool calls and agent actions.
      </p>

      {/* Environment self-check — python / bundle / key / disk / memory */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>{t('act.doctor')}</div>
          <button onClick={() => { setDoctorLoading(true); (window as any).deskAppAPI.runDoctor?.().then((r: any) => setDoctor(r)).catch(() => setDoctor(null)).finally(() => setDoctorLoading(false)) }} style={{
            background: 'var(--bg-card)', border: '1px solid var(--bg-hover)',
            borderRadius: '6px', padding: '3px 10px', color: 'var(--accent-text)', fontSize: '10px', cursor: 'pointer',
          }}>{doctorLoading ? '…' : t('act.doctorRun')}</button>
          {doctor && (
            <span style={{ fontSize: '10px', color: doctor.ok ? 'var(--ok)' : 'var(--danger-text)' }}>
              {doctor.ok ? t('act.doctorOk') : t('act.doctorFail')}
            </span>
          )}
        </div>
        {doctor && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {doctor.checks.map((c: any) => (
              <div key={c.name} style={{
                padding: '6px 10px', borderRadius: '6px', fontSize: '11px',
                background: 'var(--bg-card)', border: '1px solid var(--bg-card)',
                display: 'flex', gap: '8px', alignItems: 'flex-start',
              }}>
                <span style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)' }}>{c.ok ? '✓' : '✕'}</span>
                <span style={{ color: 'var(--ink-secondary)', minWidth: '110px' }}>{c.name}</span>
                <span style={{ color: 'var(--ink-muted)', flex: 1, wordBreak: 'break-word' }}>
                  {c.detail}
                  {!c.ok && c.hint && <span style={{ color: 'var(--accent-text)' }}> — {c.hint}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && entries.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter..." style={{
            flex: 1, background: 'var(--bg-card)', border: '1px solid var(--bg-hover)',
            borderRadius: '6px', padding: '5px 10px', fontSize: '11px', color: 'var(--ink)', outline: 'none',
          }} />
          <button onClick={() => setEntries([])} style={{
            background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)',
            borderRadius: '6px', padding: '4px 10px', color: 'var(--danger-text)', fontSize: '10px', cursor: 'pointer',
          }}>Clear</button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--ink-faint)', fontSize: '12px' }}>Loading...</div>}

      {!loading && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-faint)', fontSize: '12px' }}>
          No activity recorded yet. Start a conversation to see tool calls.
        </div>
      )}

      {stats && (
        <div style={{
          display: 'flex', gap: '12px', marginBottom: '12px',
          padding: '10px 14px', borderRadius: '8px',
          background: 'var(--bg-card)', border: '1px solid var(--line)',
          fontSize: '11px',
        }}>
          <div>Success: <b style={{ color: 'var(--ok)' }}>{stats.successRate || 0}%</b></div>
          <div>Calls: <b>{stats.totalCalls || 0}</b></div>
          <div>Errors: <b style={{ color: 'var(--danger)' }}>{stats.totalErrors || 0}</b></div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '380px', overflowY: 'auto' }}>
        {(search ? entries.filter(e => e.name?.toLowerCase().includes(search.toLowerCase()) || e.detail?.toLowerCase().includes(search.toLowerCase())) : entries).map((e, i) => (
          <div key={i} style={{
            padding: '8px 12px', borderRadius: '6px',
            background: 'var(--bg-card)', border: '1px solid var(--bg-card)',
            display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
              background: e.event === 'tool_start' ? 'var(--accent)' : 'var(--ok)',
            }} />
            <span style={{ color: 'var(--ink-muted)', fontSize: '10px', fontFamily: 'SF Mono, Monaco, monospace', minWidth: '70px' }}>
              {e.ts?.substring(11, 19) || ''}
            </span>
            <span style={{ color: 'var(--accent-text)', fontWeight: 500, minWidth: '80px' }}>{e.name}</span>
            <span style={{ color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(e.detail || '').substring(0, 80)}
            </span>
          </div>
        ))}
      </div>

      {/* D2 #45: dead-letter ring — events nobody picked up */}
      {dead.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>{t('act.deadletter')}</div>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--bg-hover)',
            borderRadius: '8px', padding: '8px 10px', maxHeight: '200px', overflowY: 'auto',
            fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px',
          }}>
            {dead.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  background: d.kind === 'ipc-error' ? 'var(--warn)' : 'var(--danger)',
                }} />
                <span style={{ color: 'var(--ink-muted)', fontSize: '10px', minWidth: '70px' }}>
                  {new Date(d.ts).toTimeString().slice(0, 8)}
                </span>
                <span style={{ color: 'var(--danger-text)', fontWeight: 500, minWidth: '90px' }}>{d.kind}</span>
                <span style={{ color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={d.detail || ''}>
                  {d.summary}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
