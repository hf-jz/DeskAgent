import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'
import type { GrantInfo } from '../../../shared/ipc-channels'
import SecurityExtras from './SecurityExtras'

type RiskClass = 'read' | 'write-low' | 'write-high' | 'destructive'

interface RiskOverride {
  pattern: string
  risk: RiskClass
}

function RISK_META(): Record<RiskClass, { label: string; color: string }> {
  return {
    'read':        { label: t('security.risk.read'), color: 'var(--ink-muted)' },
    'write-low':   { label: t('security.risk.writeLow'), color: 'var(--info)' },
    'write-high':  { label: t('security.risk.writeHigh'), color: 'var(--warn)' },
    'destructive': { label: t('security.risk.destructive'), color: 'var(--danger)' },
  }
}

function GRANT_KIND_LABELS(): Record<string, string> {
  return {
    always_tool: t('security.grant.tool'),
    always_command: t('security.grant.command'),
    always_path: t('security.grant.path'),
  }
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elev)', borderRadius: '10px',
  border: '1px solid var(--bg-hover)',
  padding: '16px', marginBottom: '12px',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px',
}

export default function SecurityTab(): React.JSX.Element {
  const [overrides, setOverrides] = useState<RiskOverride[]>([])
  const [grants, setGrants] = useState<GrantInfo[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [newRisk, setNewRisk] = useState<RiskClass>('write-high')
  const [loading, setLoading] = useState(true)

  const refreshGrants = (): void => {
    window.deskAppAPI.listGrants().then(setGrants).catch(() => {})
  }

  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      setOverrides((s.toolRiskOverrides as RiskOverride[] | undefined) || [])
      setLoading(false)
    })
    refreshGrants()
  }, [])

  const persistOverrides = (next: RiskOverride[]): void => {
    setOverrides(next)
    window.deskAppAPI.updateSettings({ toolRiskOverrides: next } as any)
  }

  const addOverride = (): void => {
    const pattern = newPattern.trim()
    if (!pattern) return
    if (overrides.some(o => o.pattern === pattern)) return
    persistOverrides([...overrides, { pattern, risk: newRisk }])
    setNewPattern('')
  }

  const removeOverride = (pattern: string): void => {
    persistOverrides(overrides.filter(o => o.pattern !== pattern))
  }

  const removeGrant = (g: GrantInfo): void => {
    window.deskAppAPI.removeGrant(g.kind, g.tool, g.command, g.path).then(refreshGrants).catch(() => {})
  }

  const clearGrants = (): void => {
    window.deskAppAPI.clearGrants().then(refreshGrants).catch(() => {})
  }

  if (loading) {
    return <div style={{ color: 'var(--ink-muted)', padding: '20px' }}>Loading...</div>
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>{t('settings.tab.security')}</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '20px' }}>
        {t('security.desc')}
      </p>

      {/* ── 工具风险覆盖 ── */}
      <div style={cardStyle}>
        <label style={labelStyle}>{t('security.overrideTitle')}</label>
        <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: 0, marginBottom: '10px' }}>
          {t('security.overrideDesc')}
        </p>
        {overrides.length === 0 && (
          <div style={{ fontSize: '11px', color: 'var(--ink-faint)', marginBottom: '10px' }}>{t('security.noOverrides')}</div>
        )}
        {overrides.map(o => (
          <div key={o.pattern} style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px',
            fontSize: '12px',
          }}>
            <code style={{
              flex: 1, background: 'var(--bg-card)', borderRadius: '6px',
              padding: '5px 8px', fontSize: '11px', color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{o.pattern}</code>
            <span style={{ color: RISK_META()[o.risk].color, fontSize: '11px', minWidth: '64px' }}>
              {RISK_META()[o.risk].label}
            </span>
            <button onClick={() => removeOverride(o.pattern)} style={{
              background: 'none', border: 'none', color: 'var(--ink-faint)',
              cursor: 'pointer', fontSize: '13px', padding: '2px 6px',
            }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <input
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            placeholder={t('security.patternPlaceholder')}
            onKeyDown={e => { if (e.key === 'Enter') addOverride() }}
            style={{
              flex: 1, background: 'var(--line)',
              border: '1px solid var(--solid)', borderRadius: '6px',
              padding: '6px 10px', fontSize: '12px', color: 'var(--ink)', outline: 'none',
            }}
          />
          <select
            value={newRisk}
            onChange={e => setNewRisk(e.target.value as RiskClass)}
            style={{
              background: 'var(--line)', border: '1px solid var(--solid)',
              borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: 'var(--ink)', outline: 'none',
            }}
          >
            {(Object.keys(RISK_META) as RiskClass[]).map(r => (
              <option key={r} value={r} style={{ background: 'var(--bg-elev)' }}>{RISK_META()[r].label}</option>
            ))}
          </select>
          <button onClick={addOverride} style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', border: 'none',
            borderRadius: '6px', padding: '6px 14px', color: 'var(--ink)', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer',
          }}>{t('security.add')}</button>
        </div>
      </div>

      {/* ── 会话授权 ── */}
      <div style={cardStyle}>
        <label style={labelStyle}>{t('security.grantsTitle')}</label>
        <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: 0, marginBottom: '10px' }}>
          {t('security.grantsDesc')}
        </p>
        {grants.length === 0 && (
          <div style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{t('security.noGrants')}</div>
        )}
        {grants.map((g, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px',
          }}>
            <span style={{ fontSize: '11px', color: 'var(--info)', minWidth: '110px' }}>
              {GRANT_KIND_LABELS()[g.kind] || g.kind}
            </span>
            <code style={{
              flex: 1, background: 'var(--bg-card)', borderRadius: '6px',
              padding: '5px 8px', fontSize: '11px', color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{g.tool.startsWith('input:') ? t('security.inputRisk', { cat: g.tool.slice(6) }) : (g.command || g.path || g.tool)}</code>
            <button onClick={() => removeGrant(g)} style={{
              background: 'none', border: 'none', color: 'var(--ink-faint)',
              cursor: 'pointer', fontSize: '13px', padding: '2px 6px',
            }}>✕</button>
          </div>
        ))}
        {grants.length > 0 && (
          <button onClick={clearGrants} style={{
            marginTop: '8px', background: 'var(--danger-soft)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '6px', padding: '6px 14px', color: 'var(--danger)', fontSize: '12px',
          }}>{t('security.clearAll')}</button>
        )}
      </div>

      {/* #29/#30: secrets vault + workspace trust */}
      <SecurityExtras />
    </div>
  )
}
