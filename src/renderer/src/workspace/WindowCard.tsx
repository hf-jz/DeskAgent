// ── WindowCard: wenxibuddy CoverFlowDeck card — title/quarter/score/action ──
import React, { useState } from 'react'
import { t } from '../lib/i18n'
import { motion } from 'framer-motion'
import { Play, Pause, FileText } from 'lucide-react'
import type { WindowSpec, SpecStatus } from '../../../shared/gen-ui-types'

export const FROST: React.CSSProperties = {
  // Light emerald frosted glass — wenxibuddy's inactive cards read light green
  // (their white cards sit over an emerald glow); on a transparent desktop we
  // tint the card itself + a dark base so every card shows color.
  // No backdrop-filter: it's a no-op on a transparent window and forces GPU
  // re-composite of every card per frame while dragging → jank.
  background: 'linear-gradient(160deg, rgba(167,243,208,0.40) 0%, rgba(110,231,183,0.20) 50%, rgba(52,211,153,0.12) 100%), rgba(8,32,24,0.42)',
  border: '1px solid rgba(167,243,208,0.35)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.15), 0 20px 40px rgba(0,0,0,0.45)',
}
export const FROST_ACTIVE: React.CSSProperties = {
  background: 'linear-gradient(155deg, rgba(52,211,153,0.55) 0%, rgba(16,185,129,0.75) 40%, rgba(4,120,87,0.85) 100%)',
  border: '1px solid rgba(167,243,208,0.55)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 0 40px rgba(16,185,129,0.45), 0 24px 50px rgba(0,0,0,0.5)',
}

export const scoreFor = (st?: SpecStatus): number => {
  if (!st) return 0
  if (st.status === 'ok') return 100
  if (st.status === 'running') return 66
  if (st.status === 'error') return 0
  return 33
}

export const statusText = (st?: SpecStatus): string => {
  if (!st) return t('wc.dormant')
  if (st.status === 'running') return t('wc.running')
  if (st.status === 'ok') return t('wc.ok')
  if (st.status === 'error') return t('wc.error')
  return t('wc.dormant')
}

interface Props {
  spec?: WindowSpec
  status?: SpecStatus
  active?: boolean
  /** Template/slot card — frost card with icon+title, action creates. */
  slot?: boolean
  slotIcon?: string
  slotTitle?: string
  /** Draft state — card window before a spec has been defined in the bubble. */
  empty?: boolean
  onOpen?: () => void  // fallback action when no onRun (templates: create)
  onRun?: () => void   // run/stop toggle — caller branches on status
  onMinimize?: () => void  // yellow: dock back into the deck
  onMaximize?: () => void  // green: pull out for re-editing
  onNameDraft?: (title: string) => void  // draft card: name the window
  canRun?: boolean
  onClose?: () => void // red: deck = delete; card window = close + stop
  /** Standalone card window (CardApp) — native app-region drag surface */
  dragSurface?: boolean
}

export default function WindowCard({ spec, status, active = true, slot, slotIcon, slotTitle, empty, onOpen, onRun, onMinimize, onMaximize, onNameDraft, canRun, onClose, dragSurface }: Props) {
  const frost = active ? FROST_ACTIVE : FROST
  const running = !!spec && status?.status === 'running'
  const [draftName, setDraftName] = useState('')
  // ponytail: the standalone CARD window (CardApp passes dragSurface) drags via
  // the native app-region (system-smooth, no polling jank); the dock's deck
  // cards must stay no-drag so card clicks/wheel keep working.
  const isCardWindow = !!dragSurface
  const history: { title: string; content: string; ts: number }[] = Array.isArray(spec?.props?.history) ? spec.props.history : []
  // wenxibuddy card fields: title / quarter / completionRate / type
  const title = spec ? spec.title : empty ? t('wc.waiting') : (slotTitle || t('wc.newWindow'))
  const rate = spec ? scoreFor(status) : 0
  const type = spec ? statusText(status) : empty ? t('wc.draft') : t('wc.clickCreate')
  const lastRun = status?.lastRun
    ? t('wc.lastRun', { time: new Date(status.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : ''

  return (
    <div
      onClickCapture={(e) => {
        // Deck stacking can cover the round ▶ with a sibling DIV — a click
        // within the button's rect that lands elsewhere routes to the button
        // so run/stop always fires from the visible button area.
        const btn = e.currentTarget.querySelector<HTMLElement>('[data-ntd][title*="运行"]')
        if (!btn || (e.target as HTMLElement).closest?.('[data-ntd]')) return
        const r = btn.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) btn.click()
      }}
      style={{
      position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box',
      borderRadius: 20, overflow: 'hidden', padding: 16,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      WebkitAppRegion: (isCardWindow ? 'drag' : 'no-drag') as any,  // card window: OS drag; dock: content stays interactive
      ...frost,
    }}>
      {/* Document texture */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.3 }}>
        <div style={{ position: 'absolute', top: '36%', left: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.40)', width: '100%' }} />
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.30)', width: '88%' }} />
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.25)', width: '72%' }} />
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.20)', width: '80%' }} />
          <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.15)', width: '60%' }} />
        </div>
      </div>

      {/* macOS traffic lights (top-left, no-drag) */}
      {(onClose || onMinimize || onMaximize) && (
        <div
          data-ntd
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 10, left: 10, zIndex: 30,
            display: 'flex', gap: 7, WebkitAppRegion: 'no-drag' as any,
          }}
        >
          <span
            onClick={(e) => { e.stopPropagation(); onClose?.() }}
            title={onClose ? t('wc.closeDel') : t('wc.close')}
            style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', cursor: onClose ? 'pointer' : 'default', border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0 }}
          />
          <span
            onClick={(e) => { e.stopPropagation(); onMinimize?.() }}
            title={onMinimize ? t('wc.minimizeRoll') : t('wc.minimize')}
            style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', cursor: onMinimize ? 'pointer' : 'default', border: '1px solid rgba(0,0,0,0.25)', opacity: onMinimize ? 1 : 0.35, flexShrink: 0 }}
          />
          <span
            onClick={(e) => { e.stopPropagation(); onMaximize?.() }}
            title={onMaximize ? t('wc.maximizeEdit') : t('wc.maximize')}
            style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', cursor: onMaximize ? 'pointer' : 'default', border: '1px solid rgba(0,0,0,0.25)', opacity: onMaximize ? 1 : 0.35, flexShrink: 0 }}
          />
        </div>
      )}

      {/* Top: title + quarter — draft cards get a name input instead */}
      {empty && onNameDraft ? (
        <div style={{ position: 'relative', zIndex: 10, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            data-ntd
            autoFocus value={draftName} onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              // isComposing: Enter during IME composition confirms the candidate, not the field
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && draftName.trim()) onNameDraft(draftName.trim())
            }}
            placeholder={t('wc.titlePlaceholder')}
            style={{
              background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 8, padding: '6px 8px', color: '#fff', fontSize: 13, outline: 'none',
              width: '100%', boxSizing: 'border-box', WebkitAppRegion: 'no-drag' as any,
            }}
          />
          <button
            data-ntd
            onClick={() => { if (draftName.trim()) onNameDraft(draftName.trim()) }}
            style={{
              alignSelf: 'flex-start', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
              color: '#fff', fontSize: 11, borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              WebkitAppRegion: 'no-drag' as any,
            }}
          >{t('wc.name')}</button>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
            {t('wc.nameHint')}
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', zIndex: 10, paddingRight: 8, paddingTop: (onClose || onMinimize || onMaximize) ? 14 : 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {slot && slotIcon && !spec ? `${slotIcon} ` : ''}{title}
        </div>
        <div style={{ fontSize: 11, marginTop: 2, color: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {spec ? (spec.cron
            ? <span title={t('wc.openAutomation')} onClick={(e) => { e.stopPropagation(); window.deskAppAPI.openSettings?.() }} style={{ cursor: 'pointer', WebkitAppRegion: 'no-drag' as any }}>⏱ {spec.cron.schedule}</span>
            : spec.kind) : empty ? t('wc.describe') : (slotTitle || t('wc.newWindow'))}{lastRun}
        </div>
        </div>
      )}

      {/* Middle: content list (above) + big score (active) / type + score (inactive) */}
      <div style={{ position: 'relative', zIndex: 10, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 44, minHeight: 0 }}>
        {history.length > 0 && (
          <div data-scroll style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -6px 8px', pointerEvents: 'auto', WebkitAppRegion: 'no-drag' as any }}>
            {history.slice().reverse().map((it, i) => (
              <div
                key={it.ts ?? i}
                data-ntd
                onClick={(e) => { e.stopPropagation(); window.deskAppAPI?.detailOpen?.(it.title, it.content) }}
                onMouseEnter={(e) => { const t = e.currentTarget.querySelector('[data-t]') as HTMLElement; if (t) t.style.color = '#99f6d4' }}
                onMouseLeave={(e) => { const t = e.currentTarget.querySelector('[data-t]') as HTMLElement; if (t) t.style.color = '#e8edf2' }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '9px 4px', cursor: 'pointer',
                  borderBottom: i < history.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}
              >
                <FileText style={{ width: 15, height: 15, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                <span data-t style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: '#e8edf2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>
                  {it.ts ? new Date(it.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {active ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, letterSpacing: -1, color: '#fff' }}>{rate}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{t('wc.status')}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>{type}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: -0.5 }}>{rate}</div>
          </div>
        )}
      </div>

      {/* Action button: run/stop indicator (▶ while idle, = while running) */}
      {(onOpen || onRun) && (
        <motion.div
          data-ntd
          onClick={(e) => { e.stopPropagation(); window.deskAppAPI?.genui?.log?.(`[card] play ${title} onRun=${!!onRun} cron=${!!spec?.cron}`); onRun ? onRun() : onOpen?.() }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          title={onRun ? (running ? t('wc.stopRun') : canRun ? t('wc.backgroundRun') : t('wc.needCron')) : t('wc.open')}
          style={{
            position: 'absolute', zIndex: 20, bottom: 14, right: 14,
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer', WebkitAppRegion: 'no-drag' as any,
            width: active ? 44 : 36, height: active ? 44 : 36,
            opacity: onRun && !canRun ? 0.45 : 1,
            background: active
              ? 'linear-gradient(145deg, rgba(255,255,255,0.42), rgba(255,255,255,0.12))'
              : 'linear-gradient(145deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06))',
            backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.4)',
            boxShadow: active
              ? 'inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 24px rgba(0,0,0,0.35), 0 0 20px rgba(255,255,255,0.12)'
              : 'inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px rgba(0,0,0,0.3)',
          }}
        >
          {running
            ? <Pause style={{ fill: '#fff', color: '#fff', width: active ? 16 : 12, height: active ? 16 : 12 }} />
            : <Play style={{ fill: '#fff', color: '#fff', transform: 'translateX(1px)', width: active ? 18 : 14, height: active ? 18 : 14 }} />}
        </motion.div>
      )}
    </div>
  )
}
