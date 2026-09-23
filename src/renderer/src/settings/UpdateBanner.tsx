// ── D1 #44 / P1 #22: update banner — settings-window header strip ──
// States: available (下载) → downloading (进度) → downloaded (重启更新).
// Dismiss is per-version (dismissedUpdateVersion in settings). Unsigned dev
// builds never reach here (updater stays idle outside packaged apps).
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'

interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

export default function UpdateBanner(): React.JSX.Element | null {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.deskAppAPI.getUpdateStatus?.().then((st: UpdateStatus) => st && setS(st)).catch(() => {})
    const unsub = window.deskAppAPI.onUpdateStatus?.((st: UpdateStatus) => setS(st)) || (() => {})
    return () => unsub()
  }, [])

  if (s.state === 'idle' || s.state === 'checking') return null

  const bar: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 14px', marginBottom: '12px',
    background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
    borderRadius: '8px', fontSize: '12px', color: 'var(--ink)',
  }
  const btn = (primary: boolean): React.CSSProperties => ({
    background: primary ? 'var(--accent)' : 'var(--line)',
    border: primary ? 'none' : '1px solid var(--solid)',
    borderRadius: '6px', padding: '4px 12px', color: 'var(--ink)',
    fontSize: '11px', cursor: 'pointer',
  })

  return (
    <div style={bar}>
      {s.state === 'available' && (
        <>
          <span style={{ flex: 1 }}>{t('upd.available', { ver: s.version })}</span>
          <button style={btn(true)} onClick={() => window.deskAppAPI.downloadUpdate()}>{t('upd.download')}</button>
          <button style={btn(false)} onClick={() => { window.deskAppAPI.dismissUpdate(s.version || ''); setS({ state: 'idle' }) }}>{t('upd.later')}</button>
        </>
      )}
      {s.state === 'downloading' && <span style={{ flex: 1 }}>{t('upd.downloading', { pct: s.percent ?? 0 })}</span>}
      {s.state === 'downloaded' && (
        <>
          <span style={{ flex: 1 }}>{t('upd.ready', { ver: s.version })}</span>
          <button style={btn(true)} onClick={() => window.deskAppAPI.installUpdate()}>{t('upd.restart')}</button>
          <button style={btn(false)} onClick={() => setS({ state: 'idle' })}>{t('upd.later')}</button>
        </>
      )}
      {s.state === 'error' && (
        <>
          <span style={{ flex: 1, color: 'var(--danger-text)' }}>{t('upd.failed', { msg: s.message })}</span>
          <button style={btn(false)} onClick={() => setS({ state: 'idle' })}>{t('upd.gotIt')}</button>
        </>
      )}
    </div>
  )
}
