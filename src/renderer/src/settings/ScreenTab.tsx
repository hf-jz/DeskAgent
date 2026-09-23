import { useCallback, useEffect, useState } from 'react'
import { t } from '../lib/i18n'

const EMERALD = '#34d399'
const MUTED = 'rgba(255,255,255,0.45)'
const EDGE = 'rgba(255,255,255,0.14)'

export default function ScreenTab(): React.JSX.Element {
  const [perm, setPerm] = useState<{ accessibility: boolean; screen: string } | null>(null)
  const [apps, setApps] = useState<Array<{ name: string; pid: number }>>([])

  const refresh = useCallback(() => {
    window.deskAppAPI.screen.perm().then(setPerm).catch(() => {})
    window.deskAppAPI.screen.listApps().then(setApps).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const permBadge = (ok: boolean): { c: string; bg: string; label: string } => ok
    ? { c: EMERALD, bg: 'rgba(52,211,153,0.12)', label: t('screen.granted') }
    : { c: '#f87171', bg: 'rgba(248,113,113,0.12)', label: t('screen.notGranted') }

  const a = permBadge(perm?.accessibility ?? false)
  const s = permBadge(perm?.screen === 'granted')

  const card: React.CSSProperties = { padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: `1px solid ${EDGE}` }
  const rowBtn: React.CSSProperties = { marginTop: 10, padding: '7px 14px', borderRadius: 10, background: 'rgba(52,211,153,0.12)', border: `1px solid ${EMERALD}44`, color: EMERALD, fontSize: 12, cursor: 'pointer' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{t('screen.title')}</div>
      <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.7 }}>{t('screen.intro')}</div>

      {/* 权限状态 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>🎛 {t('screen.permAccessibility')}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10.5, padding: '2px 9px', borderRadius: 999, color: a.c, background: a.bg }}>{a.label}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>{t('screen.permAccessibilityHint')}</div>
          {!perm?.accessibility && (
            <button onClick={() => window.deskAppAPI.screen.openPrefs('accessibility')} style={rowBtn}>{t('screen.goSettings')}</button>
          )}
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>🎬 {t('screen.permScreen')}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10.5, padding: '2px 9px', borderRadius: 999, color: s.c, background: s.bg }}>{s.label}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>{t('screen.permScreenHint')}</div>
          {perm?.screen !== 'granted' && (
            <button onClick={() => window.deskAppAPI.screen.openPrefs('screen')} style={rowBtn}>{t('screen.goSettings')}</button>
          )}
        </div>
      </div>

      {/* 运行中的应用 */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>🖥 {t('screen.runningApps')}（{apps.length}）</div>
          <button onClick={refresh} style={{ fontSize: 10.5, color: EMERALD, background: 'none', border: 'none', cursor: 'pointer' }}>{t('screen.refresh')}</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, maxHeight: 180, overflowY: 'auto' }}>
          {apps.map(x => (
            <span key={x.pid} style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.7)' }}>{x.name}</span>
          ))}
          {apps.length === 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{t('screen.noApps')}</span>}
        </div>
      </div>

      {/* 使用方式 */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>🤖 {t('screen.howToTitle')}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.8 }}>{t('screen.howToBody')}</div>
      </div>
    </div>
  )
}
