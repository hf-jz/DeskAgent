import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

/** P2-C1 #29/#30: secrets (names only) + workspace trust list. Rendered inside SecurityTab. */
export default function SecurityExtras(): React.JSX.Element {
  const [secrets, setSecrets] = useState<string[]>([])
  const [trusted, setTrusted] = useState<string[]>([])
  const [status, setStatus] = useState<{ dir: string; trusted: boolean } | null>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [dir, setDir] = useState('')
  const [roots, setRoots] = useState<string[]>([])
  const [rootDir, setRootDir] = useState('')
  const [mcp, setMcp] = useState<{ servers: { name: string; transport: string }[]; configPath: string } | null>(null)

  const reload = (): void => {
    window.deskAppAPI.listSecrets().then(setSecrets).catch(() => {})
    window.deskAppAPI.listTrusted().then(setTrusted).catch(() => {})
    window.deskAppAPI.trustStatus().then(setStatus).catch(() => {})
    window.deskAppAPI.listVfsRoots().then(setRoots).catch(() => {})
    window.deskAppAPI.mcpStatus().then(setMcp).catch(() => {})
  }
  useEffect(reload, [])

  const card: React.CSSProperties = {
    marginTop: 12, padding: '12px 14px', borderRadius: 8,
    background: 'var(--bg-card)', border: '1px solid var(--line)',
  }
  const input: React.CSSProperties = {
    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--solid)', borderRadius: 6,
    color: 'var(--ink)', fontSize: 12, padding: '5px 8px', outline: 'none',
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }

  return (
    <>
      {/* #23: LLM provider re-config — opens the bubble's onboarding card */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('sext.provider')}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
          {t('sext.providerDesc')}
        </div>
        <button onClick={() => window.deskAppAPI.openOnboarding?.()} style={{
          padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
          background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', color: 'var(--accent-text)',
        }}>{t('sext.reconfig')}</button>
      </div>
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('sext.secrets')}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
          {t('sext.secretsDesc')}
        </div>
        {secrets.map(s => (
          <div key={s} style={row}>
            <span style={{ flex: 1, color: 'var(--ink)' }}>{s}</span>
            <button onClick={() => window.deskAppAPI.deleteSecret(s).then(reload)} style={{
              background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 13,
            }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('sext.name')} style={{ ...input, width: 120 }} />
          <input value={value} onChange={e => setValue(e.target.value)} placeholder={t('sext.value')} type="password" style={{ ...input, flex: 1 }} />
          <button onClick={() => {
            if (name.trim() && value) window.deskAppAPI.setSecret(name, value).then(() => { setName(''); setValue(''); reload() })
          }} style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
            background: 'var(--info-soft)', border: '1px solid var(--info)', color: 'var(--info)',
          }}>{t('sext.save')}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('sext.trust')}</div>
        {status && (
          <div style={{ fontSize: 11, color: status.trusted ? 'var(--ok)' : 'var(--warn)', marginBottom: 8 }}>
            {t('sext.trustState', { dir: status.dir, state: status.trusted ? t('sext.trusted') : t('sext.untrusted') })}
            {!status.trusted && (
              <span onClick={() => window.deskAppAPI.trustDir(status.dir).then(reload)}
                style={{ marginLeft: 8, color: 'var(--info)', cursor: 'pointer' }}>{t('sext.trustDir')}</span>
            )}
          </div>
        )}
        {trusted.map(d => (
          <div key={d} style={row}>
            <span style={{ flex: 1, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d}</span>
            <button onClick={() => window.deskAppAPI.untrustDir(d).then(reload)} style={{
              background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 13,
            }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={dir} onChange={e => setDir(e.target.value)} placeholder="/path/to/dir" style={{ ...input, flex: 1 }} />
          <button onClick={() => {
            if (dir.trim()) window.deskAppAPI.trustDir(dir).then(() => { setDir(''); reload() })
          }} style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
            background: 'var(--info-soft)', border: '1px solid var(--info)', color: 'var(--info)',
          }}>{t('sext.add')}</button>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('sext.roots')}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
          {t('sext.rootsDesc')}
        </div>
        {roots.map((r, i) => (
          <div key={r} style={row}>
            <span style={{ flex: 1, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {i === 0 ? '📦 ' : ''}{r}
            </span>
            {i > 0 && (
              <button onClick={() => window.deskAppAPI.removeVfsRoot(r).then(reload)} style={{
                background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 13,
              }}>✕</button>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={rootDir} onChange={e => setRootDir(e.target.value)} placeholder="/path/to/dir" style={{ ...input, flex: 1 }} />
          <button onClick={() => {
            if (rootDir.trim()) window.deskAppAPI.addVfsRoot(rootDir).then(() => { setRootDir(''); reload() })
          }} style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
            background: 'var(--info-soft)', border: '1px solid var(--info)', color: 'var(--info)',
          }}>{t('sext.add')}</button>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('sext.mcp')}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
          {t('sext.mcpDesc')}
        </div>
        {mcp && mcp.servers.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{t('sext.noMcp')}</div>
        )}
        {mcp?.servers.map(s => (
          <div key={s.name} style={row}>
            <span style={{ flex: 1, color: 'var(--ink)' }}>🔌 {s.name}</span>
            <span style={{ color: 'var(--ink-faint)' }}>{s.transport}</span>
          </div>
        ))}
      </div>
    </>
  )
}
