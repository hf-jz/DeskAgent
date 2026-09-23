import { useState } from 'react'
import { t } from '../lib/i18n'
import { flag, setFlag, FLAG_LABELS, type FlagName } from '../flags'

const SHORTCUTS = [
  { key: 'Cmd/Ctrl + Shift + M', action: 'Open task bubble' },
  { key: 'Cmd/Ctrl + Shift + H', action: 'Hide pet to edge / Show pet' },
  { key: 'Cmd/Ctrl + Shift + ,', action: 'Open Settings' },
  { key: 'Cmd/Ctrl + Shift + E', action: 'Open File Explorer' },
  { key: 'Enter (in bubble)', action: 'Send message' },
  { key: 'Shift + Enter', action: 'New line (no send)' },
  { key: 'Escape (in bubble)', action: 'Clear input' },
]

const TIPS = [
  'Drag pet to any screen edge → auto-hides, mouse near edge → shows again.',
  'Type "写到代码" → auto-switches to Claude Code agent.',
  'Click the agent name in bubble header → switch agents.',
  'Set a daily budget in Appearance → agent pauses when exceeded.',
  'Click "Export Session" below cards → save conversation as JSON.',
  'Open Settings → Skills → Discover → Refresh from Community for new skills.',
  'Open Settings → Activity → see every tool call your agent made.',
]

export default function ShortcutsTab(): React.JSX.Element {
  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Shortcuts & Tips</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '20px' }}>
        Keyboard shortcuts and pro tips for DeskApp.
      </p>

      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        overflow: 'hidden', marginBottom: '16px'
      }}>
        {SHORTCUTS.map((s, i) => (
          <div key={s.key} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px',
            borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--line)' : 'none',
            fontSize: '13px'
          }}>
            <span style={{ color: 'var(--ink-secondary)' }}>{s.action}</span>
            <kbd style={{
              background: 'var(--solid)', border: '1px solid var(--line-strong)',
              borderRadius: '5px', padding: '3px 10px', fontSize: '11px',
              fontFamily: 'SF Mono, Monaco, monospace', color: 'var(--ink-secondary)'
            }}>{s.key}</kbd>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: 'var(--accent-text)' }}>💡 Pro Tips</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {TIPS.map((tip, i) => (
          <div key={i} style={{
            padding: '10px 14px', borderRadius: '8px',
            background: 'var(--bg-card)', border: '1px solid var(--bg-card)',
            fontSize: '11px', color: 'var(--ink-secondary)', lineHeight: 1.5,
          }}>
            {tip}
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '16px 0 8px', color: 'var(--accent-text)' }}>{t('shortcuts.experimental')}</h3>
      <ExperimentalFlags />
    </div>
  )
}

/** #39: off-by-default feature flags */
function ExperimentalFlags(): React.JSX.Element {
  const [, force] = useState(0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {(Object.keys(FLAG_LABELS) as FlagName[]).map(name => (
        <div key={name} onClick={() => { setFlag(name, !flag(name)); force(n => n + 1) }} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8,
          background: 'var(--bg-card)', border: '1px solid var(--bg-card)',
          fontSize: 11, color: 'var(--ink-secondary)', cursor: 'pointer',
        }}>
          <span style={{ color: flag(name) ? 'var(--ok)' : 'var(--ink-faint)' }}>{flag(name) ? '●' : '○'}</span>
          <span style={{ flex: 1 }}>{FLAG_LABELS()[name]}</span>
        </div>
      ))}
    </div>
  )
}
