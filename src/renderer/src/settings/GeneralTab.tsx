import { useState, useEffect } from 'react'
import { t, useLang } from '../lib/i18n'

// General: display language + thinking-card default state.
// language 走主进程 settings 管道（settings:get/update + settings-changed 广播），
// renderer/main 共享同一语言源；thinkingOpen 保持本地持久化（与语言无关）。
const GENERAL_KEY = 'deskapp-general'

export function loadGeneral(): { thinkingOpen: boolean } {
  try {
    const raw = localStorage.getItem(GENERAL_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      return { thinkingOpen: d.thinkingOpen !== false }
    }
  } catch { /* ignore */ }
  return { thinkingOpen: true }
}

export default function GeneralTab(): React.JSX.Element {
  const { t: _t } = useLang()
  const [thinkingOpen, setThinkingOpen] = useState(loadGeneral().thinkingOpen)
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(GENERAL_KEY, JSON.stringify({ thinkingOpen })) } catch { /* ignore */ }
  }, [thinkingOpen])

  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      setLanguage(s.language || 'zh')
      setReady(true)
    }).catch(() => setReady(true))
    const unsub = window.deskAppAPI.onSettingsChanged?.((s: { language?: 'zh' | 'en' }) => {
      if (s.language) setLanguage(s.language)
    })
    return unsub || (() => {})
  }, [])

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line, rgba(255,255,255,0.07))' }
  const label = { fontSize: 13, color: 'var(--ink)' }
  const desc = { fontSize: 11, color: 'var(--ink-secondary, rgba(255,255,255,0.5))', marginTop: 3 }
  const select: React.CSSProperties = { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--ink)', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px' }}>General</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-secondary, rgba(255,255,255,0.5))', marginBottom: 8 }}>
        {t('settings.general.title')}
      </div>

      <div style={row}>
        <div>
          <div style={label}>{t('settings.general.language')}</div>
          <div style={desc}>{t('settings.general.languageDesc')}</div>
        </div>
        <select
          value={language}
          disabled={!ready}
          onChange={e => {
            const v = e.target.value as 'zh' | 'en'
            setLanguage(v)
            window.deskAppAPI.updateSettings({ language: v }).catch(() => {})
          }}
          style={select}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div style={row}>
        <div>
          <div style={label}>{t('settings.general.thinking')}</div>
          <div style={desc}>{t('settings.general.thinkingDesc')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['open', t('settings.general.open')], ['fold', t('settings.general.fold')]] as const).map(([k, name]) => (
            <button
              key={k}
              onClick={() => setThinkingOpen(k === 'open')}
              style={{
                ...select, cursor: 'pointer',
                background: (k === 'open' ? thinkingOpen : !thinkingOpen) ? 'var(--accent, #34d399)' : 'rgba(255,255,255,0.08)',
                color: (k === 'open' ? thinkingOpen : !thinkingOpen) ? '#06281c' : 'var(--ink)',
                fontWeight: 600, border: 'none',
              }}
            >{name}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
