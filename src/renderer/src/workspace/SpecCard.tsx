// ── SpecCard: renders title bar + kind badge + component + action buttons ──
// Restyled to match wenxibuddy: glass card, emerald accent, rounded edges.
import React from 'react'
import { t } from '../lib/i18n'
import type { WindowSpec, SpecStatus } from '../../../shared/gen-ui-types'
import { COMPONENTS } from './components'

const G = 'Plus Jakarta Sans, PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif'
const GLASS = 'rgba(255,255,255,0.045)'
const EDGE = 'rgba(255,255,255,0.14)'

interface Props {
  spec: WindowSpec
  status?: SpecStatus
}

export default function SpecCard({ spec, status }: Props) {
  const Component = COMPONENTS[spec.kind]
  const handleRun = () => window.deskAppAPI?.genui?.runSpec(spec.id)
  const handleStop = () => window.deskAppAPI?.genui?.stopSpec(spec.id)
  const handleDelete = async () => {
    await window.deskAppAPI?.genui?.removeSpec(spec.id)
  }

  // Manual field edit: cron schedule + prompt, saved on blur (spec is the doc)
  const saveCron = (patch: Partial<NonNullable<WindowSpec['cron']>>) => {
    window.deskAppAPI?.genui?.saveSpec({ ...spec, cron: { ...spec.cron!, ...patch } })
  }

  const running = status?.status === 'running'
  const statusDot = status?.status === 'ok' ? '🟢' : status?.status === 'error' ? '🔴' : running ? '⚪' : ' ⚪'

  return (
    <div style={{
      background: GLASS, borderRadius: 16,
      border: `1px solid ${EDGE}`, overflow: 'hidden', fontFamily: G,
      backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: `1px solid ${EDGE}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{spec.title}</span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 999,
            background: 'rgba(34,197,94,0.14)', color: '#34d399',
          }}>{spec.kind}</span>
          {spec.cron && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{statusDot}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {spec.cron && (
            running
              ? <button onClick={handleStop} style={btnStyle('rgba(251,146,60,0.9)')}>⏹ Stop</button>
              : <button onClick={handleRun} style={{ ...btnStyle('#34d399'), background: 'rgba(34,197,94,0.15)' }}>▶ Run</button>
          )}
          <button onClick={handleDelete} style={btnStyle('rgba(248,113,113,0.9)')}>✕</button>
        </div>
      </div>

      {/* Cron config — editable, saved on blur */}
      {spec.cron && (
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${EDGE}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            defaultValue={spec.cron.schedule}
            onBlur={e => e.target.value !== spec.cron!.schedule && saveCron({ schedule: e.target.value })}
            placeholder="cron: 0 9,17 * * *"
            style={inputStyle}
          />
          <textarea
            defaultValue={spec.cron.prompt}
            onBlur={e => e.target.value !== spec.cron!.prompt && saveCron({ prompt: e.target.value })}
            placeholder={t('speccard.promptPlaceholder')}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      )}

      {/* Task props — topic/detail/webhook editable, saved on blur (spec is the doc) */}
      {CONFIG_PROPS.some(k => typeof spec.props[k] === 'string') && (
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${EDGE}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CONFIG_PROPS.filter(k => typeof spec.props[k] === 'string').map(k => (
            <input
              key={k}
              defaultValue={spec.props[k]}
              onBlur={e => e.target.value !== spec.props[k] &&
                window.deskAppAPI?.genui?.saveSpec({ ...spec, props: { ...spec.props, [k]: e.target.value } })}
              placeholder={PROP_LABELS()[k]}
              style={inputStyle}
            />
          ))}
        </div>
      )}

      {/* Body */}
      <div style={{ padding: 14, minHeight: 80 }}>
        {Component ? <Component {...spec.props} /> : <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Unknown component: {spec.kind}</div>}
      </div>
    </div>
  )
}

const CONFIG_PROPS = ['topic', 'detail', 'webhook'] as const
function PROP_LABELS(): Record<string, string> {
  return {
    topic: t('speccard.prop.topic'), detail: t('speccard.prop.detail'), webhook: t('speccard.prop.webhook'),
  }
}

const btnStyle = (color: string): React.CSSProperties => ({
  background: 'transparent', color, border: `1px solid ${color}40`, borderRadius: 8,
  padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: G,
})

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)',
  border: `1px solid ${EDGE}`, borderRadius: 8,
  padding: '6px 9px', fontSize: 11, fontFamily: G, outline: 'none', width: '100%',
  boxSizing: 'border-box',
}
