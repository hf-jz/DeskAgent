import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'

export interface PermissionReq {
  id: string
  command: string
  description: string
  allowPermanent: boolean
  smartDenied: boolean
  /** #12: risk class from main-side classifyTool; low risks get compact row */
  risk?: string
}

/** #12 five decisions; BubbleApp maps always_x/turn onto bridge outcomes + grants */
export type PermissionOutcome = 'once' | 'always_tool' | 'always_command' | 'turn' | 'deny'

interface Props {
  req: PermissionReq
  onDecide: (id: string, outcome: PermissionOutcome) => void
}

const TIMEOUT_S = 120
const PREVIEW_CAP = 420

/**
 * Phase 6 + #12: execution-gate approval card, dual layout by risk.
 * write-low/write-high → compact row (expandable); destructive/unknown → full card.
 * The bridge auto-denies after 120s; main pushes permission:resolved on
 * timeout/abort/responded (incl. turn-grant auto-answers), removing the card.
 */
export default function ApprovalCard({ req, onDecide }: Props) {
  const [left, setLeft] = useState(TIMEOUT_S)
  const [decided, setDecided] = useState<PermissionOutcome | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showFullCmd, setShowFullCmd] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const decide = (outcome: PermissionOutcome): void => {
    if (decided) return  // first responder wins locally
    setDecided(outcome)
    onDecide(req.id, outcome)
  }

  const btn = (label: string, outcome: PermissionOutcome, color: string, bg: string, title?: string): React.ReactElement => (
    <button
      key={outcome}
      onClick={() => decide(outcome)}
      disabled={decided !== null}
      title={title}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        color: decided === null || decided === outcome ? color : 'var(--ink-faint)',
        background: decided === outcome ? bg : 'var(--line)',
        border: `1px solid ${decided === outcome ? color : 'var(--solid)'}`,
        borderRadius: 8,
        cursor: decided ? 'default' : 'pointer',
        opacity: decided && decided !== outcome ? 0.4 : 1,
        transition: 'all 0.15s',
      }}
    >{label}</button>
  )

  const compact = (req.risk === 'write-low' || req.risk === 'write-high') && !expanded
  const destructive = req.risk === 'destructive' || !req.risk
  const shortCmd = req.command.length > 40 ? req.command.slice(0, 40) + '…' : req.command

  // ── Compact row: low-risk local writes ──
  if (compact) {
    return (
      <div style={{
        margin: '6px 0', padding: '6px 10px', borderRadius: 8,
        background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.25)',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      }}>
        <span>⚠️</span>
        <code style={{
          flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
          color: 'var(--danger-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{shortCmd}</code>
        <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {decided ? t('approval.decided') : `${left}s`}
        </span>
        {btn(t('approval.allow'), 'once', 'var(--ok-text)', 'rgba(52,211,153,0.15)')}
        {btn(t('approval.deny'), 'deny', 'var(--danger-text)', 'rgba(248,113,113,0.15)')}
        <span onClick={() => setExpanded(true)} style={{ fontSize: 10, color: 'var(--info)', cursor: 'pointer' }}>更多</span>
      </div>
    )
  }

  // ── Full card ──
  const cmdLong = req.command.length > PREVIEW_CAP
  const shownCmd = showFullCmd || !cmdLong ? req.command : req.command.slice(0, PREVIEW_CAP) + ' …'
  return (
    <div style={{
      margin: '8px 0',
      padding: '12px 14px',
      borderRadius: 12,
      background: destructive ? 'rgba(239, 68, 68, 0.07)' : 'rgba(245, 158, 11, 0.08)',
      border: `1px solid ${destructive ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: destructive ? 'var(--danger)' : 'var(--warn)', flex: 1 }}>
          {destructive ? t('approval.highDanger') : t('approval.pending')}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {decided ? t('approval.decided') : t('approval.autoDeny', { s: left })}
        </span>
      </div>
      <div style={{ fontSize: 10, marginBottom: 6, color: destructive ? 'var(--warn)' : '#2DD4BF' }}>
        {destructive ? t('approval.externalEffect') : t('approval.localOnly')}
      </div>
      {req.description && (
        <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 6 }}>{req.description}</div>
      )}
      <div style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        color: 'var(--danger-text)',
        background: 'rgba(0,0,0,0.35)',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 10,
        wordBreak: 'break-all',
        maxHeight: 80,
        overflowY: 'auto',
      }}>{shownCmd}</div>
      {cmdLong && (
        <div onClick={() => setShowFullCmd(!showFullCmd)} style={{ fontSize: 10, color: 'var(--info)', cursor: 'pointer', marginTop: -6, marginBottom: 8 }}>
          {showFullCmd ? t('approval.collapse') : t('approval.expand')}
        </div>
      )}
      {req.smartDenied && (
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
          {t('approval.smartDenied')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {btn(t('approval.allowOnce'), 'once', 'var(--ok-text)', 'rgba(52,211,153,0.15)')}
        {btn(t('approval.alwaysTool'), 'always_tool', 'var(--info)', 'var(--info-soft)', t('approval.alwaysToolHint'))}
        {btn(t('approval.alwaysCmd'), 'always_command', 'var(--accent-text)', 'rgba(167,139,250,0.15)', t('approval.alwaysCmdHint'))}
        {btn(t('approval.turn'), 'turn', '#2DD4BF', 'rgba(45,212,191,0.15)', t('approval.turnHint'))}
        {btn(t('approval.deny'), 'deny', 'var(--danger-text)', 'rgba(248,113,113,0.15)')}
      </div>
    </div>
  )
}
