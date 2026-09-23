import { useState } from 'react'
import { t } from '../lib/i18n'

// ── Types ──

/** A single risk item detected from user input or tool call. */
export interface RiskItem {
  category: string
  snippet: string
  description: string
  severity: 1 | 2 | 3
}

/** Risk level from classification engine */
export type RiskClass = 'read' | 'write-low' | 'write-high' | 'destructive'

/** Available grant decisions (mirrors openworker ApprovalCard) */
export type ApprovalDecision = 'once' | 'always_tool' | 'always_command' | 'deny'

export interface RiskConfirmDialogProps {
  risks: RiskItem[]
  /** The original user input or tool call info */
  inputPreview: string
  /** Tool name (for tool-call confirmations) */
  toolName?: string
  /** Tool args (for command-level grants) */
  toolArgs?: string
  /** Risk class for color coding */
  riskClass?: RiskClass
  /** Full callback — chose one of the five options */
  onDecide: (decision: ApprovalDecision) => void
  /** Backward-compat: simple confirm/cancel */
  onConfirm?: () => void
  onCancel?: () => void
}

// ── Colors ──

function RISK_COLORS(): Record<RiskClass, { bg: string; border: string; text: string; badge: string }> {
  return {
    'read':        { bg: 'rgba(156,163,175,0.08)',  border: 'rgba(156,163,175,0.4)',  text: 'var(--ink-muted)', badge: t('risk.badge.read') },
    'write-low':   { bg: 'var(--info-soft)',    border: 'var(--info)',   text: 'var(--info)', badge: t('risk.badge.writeLow') },
    'write-high':  { bg: 'rgba(245,158,11,0.10)',    border: 'rgba(245,158,11,0.45)',  text: 'var(--warn)', badge: t('risk.badge.writeHigh') },
    'destructive': { bg: 'rgba(239,68,68,0.10)',     border: 'var(--danger)',    text: 'var(--danger)', badge: t('risk.badge.destructive') },
  }
}

const SEVERITY_COLORS: Record<number, { bg: string; border: string; text: string; badge: string }> = {
  1: RISK_COLORS()['write-low'],
  2: RISK_COLORS()['write-high'],
  3: RISK_COLORS()['destructive'],
}

// ── Styles ──

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    animation: 'fadeIn 150ms ease-out',
  } as React.CSSProperties,
  card: {
    width: 460, maxWidth: '92vw',
    background: 'rgba(28,28,32,0.98)',
    border: '1px solid var(--bg-hover)',
    borderRadius: 16,
    padding: '24px 28px 20px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px var(--bg-card)',
    display: 'flex', flexDirection: 'column' as const, gap: 14,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    color: 'var(--ink)',
    animation: 'slideUp 200ms ease-out',
  } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
  } as React.CSSProperties,
  icon: (riskClass: RiskClass) => ({
    width: 36, height: 36, borderRadius: 10,
    background: `linear-gradient(135deg, ${RISK_COLORS()[riskClass].bg.replace('0.08','0.25').replace('0.10','0.25')}, var(--bg-card))`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18,
  } as React.CSSProperties),
  title: {
    fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'var(--ink)',
  } as React.CSSProperties,
  subtitle: {
    fontSize: 12, color: 'var(--ink-muted)', marginTop: 2,
  } as React.CSSProperties,
  previewBox: {
    background: 'var(--bg-card)',
    border: '1px solid var(--line)',
    borderRadius: 8, padding: '10px 14px',
    fontSize: 12, lineHeight: 1.5, color: 'var(--ink-secondary)',
    maxHeight: 80, overflowY: 'auto' as const,
    wordBreak: 'break-word' as const,
    fontFamily: '"SF Mono", "Menlo", "Monaco", monospace',
  } as React.CSSProperties,
  scopeNote: (riskClass: RiskClass) => ({
    fontSize: 11, color: RISK_COLORS()[riskClass].text,
    padding: '4px 10px', borderRadius: 6,
    background: RISK_COLORS()[riskClass].bg,
    display: 'inline-flex', alignItems: 'center', gap: 4,
  } as React.CSSProperties),
  riskList: {
    display: 'flex', flexDirection: 'column' as const, gap: 8,
  } as React.CSSProperties,
  riskItem: (bg: string, border: string) => ({
    display: 'flex', alignItems: 'flex-start', gap: 10,
    background: bg, border: `1px solid ${border}`,
    borderRadius: 8, padding: '10px 12px',
    fontSize: 12, lineHeight: 1.5,
  } as React.CSSProperties),
  riskBadge: (color: string) => ({
    flexShrink: 0,
    padding: '1px 8px', borderRadius: 4,
    fontSize: 10, fontWeight: 600,
    color, background: 'var(--bg-card)',
  } as React.CSSProperties),
  riskContent: { flex: 1, minWidth: 0 } as React.CSSProperties,
  riskDesc: {
    color: 'var(--ink-secondary)', fontSize: 12, lineHeight: 1.4,
  } as React.CSSProperties,
  riskSnippet: {
    color: 'var(--ink-faint)', fontSize: 10, marginTop: 4,
    fontFamily: '"SF Mono", "Menlo", "Monaco", monospace',
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  // ── Five-button decision bar (P0-4A) ──
  decisions: {
    display: 'flex', flexDirection: 'column' as const, gap: 8,
  } as React.CSSProperties,
  decisionRow: {
    display: 'flex', gap: 8, justifyContent: 'flex-end',
  } as React.CSSProperties,
  primaryBtn: {
    padding: '8px 18px', borderRadius: 8, border: '1px solid var(--info)',
    background: 'var(--info-soft)', color: 'var(--info)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 150ms ease',
  } as React.CSSProperties,
  grantBtn: {
    padding: '7px 14px', borderRadius: 8,
    border: '1px solid var(--bg-hover)',
    background: 'var(--bg-card)',
    color: 'var(--ink-muted)',
    fontSize: 11, fontWeight: 400, cursor: 'pointer',
    transition: 'all 150ms ease',
  } as React.CSSProperties,
  denyBtn: {
    padding: '7px 14px', borderRadius: 8,
    border: 'none', background: 'transparent',
    color: 'var(--ink-faint)',
    fontSize: 11, fontWeight: 400, cursor: 'pointer',
    transition: 'all 150ms ease',
  } as React.CSSProperties,
}

// ── Component ──

export function RiskConfirmDialog({
  risks, inputPreview, toolName, toolArgs, riskClass = 'write-high',
  onDecide, onConfirm, onCancel,
}: RiskConfirmDialogProps) {
  const [decided, setDecided] = useState(false)
  const colors = RISK_COLORS()[riskClass] || RISK_COLORS()['write-high']

  const maxSeverity = Math.max(...risks.map(r => r.severity)) as 1 | 2 | 3
  const totalRisk = risks.length

  const handleDecide = (decision: ApprovalDecision) => {
    if (decided) return
    setDecided(true)
    onDecide(decision)
    // Backward compat
    if (decision === 'once' && onConfirm) onConfirm()
    if (decision === 'deny' && onCancel) onCancel()
  }

  const handleCancel = () => handleDecide('deny')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); handleCancel() }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDecide('once') }
  }

  return (
    <div style={S.overlay} onClick={handleCancel} onKeyDown={handleKeyDown} tabIndex={0}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      <div style={S.card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.icon(riskClass)}>⚠️</div>
          <div>
            <div style={S.title}>
              {toolName ? t('risk.confirmExec', { tool: toolName }) : t('risk.detected')}
            </div>
            <div style={S.subtitle}>
              {t('risk.count', { n: totalRisk })}
              <span style={{ color: colors.text, fontWeight: 600 }}> {colors.badge}</span>
              {toolName && (
                <span style={S.scopeNote(riskClass)}>
                  {riskClass === 'destructive' ? t('risk.destructive') :
                              riskClass === 'write-high' ? t('risk.writeHigh') :
                              riskClass === 'write-low' ? t('risk.writeLow') : t('risk.read')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Input preview */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
            {toolName ? t('risk.toolArgs') : t('risk.yourInput')}
          </div>
          <div style={S.previewBox}>{inputPreview.slice(0, 420)}</div>
        </div>

        {/* Risk list */}
        {risks.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
              {t('risk.detectedList', { n: totalRisk })}
            </div>
            <div style={S.riskList}>
              {risks.map((r, i) => {
                const c = SEVERITY_COLORS[r.severity] || SEVERITY_COLORS[1]
                return (
                  <div key={i} style={S.riskItem(c.bg, c.border)}>
                    <span style={S.riskBadge(c.text)}>{c.badge}</span>
                    <div style={S.riskContent}>
                      <div style={S.riskDesc}>{r.description}</div>
                      <div style={S.riskSnippet} title={r.snippet}>
                        {r.snippet.length > 60 ? r.snippet.slice(0, 60) + '…' : r.snippet}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Five-button decision bar (P0-4A) ── */}
        <div style={S.decisions}>
          {/* Row 1: Primary action */}
          <div style={S.decisionRow}>
            <button
              style={{ ...S.denyBtn, opacity: decided ? 0.3 : 1, cursor: decided ? 'default' : 'pointer' }}
              onClick={() => handleDecide('deny')}
              disabled={decided}
            >
              ✕ {t('risk.cancel')}
            </button>
            <button
              style={{ ...S.primaryBtn, opacity: decided ? 0.5 : 1, cursor: decided ? 'default' : 'pointer' }}
              onClick={() => handleDecide('once')}
              disabled={decided}
              onMouseEnter={e => { if (!decided) e.currentTarget.style.background = 'rgba(96,165,250,0.2)' }}
              onMouseLeave={e => { if (!decided) e.currentTarget.style.background = 'var(--info-soft)' }}
            >
              {t('risk.allowOnce')}
            </button>
          </div>

          {/* Row 2: Grant buttons */}
          <div style={{ ...S.decisionRow, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...S.grantBtn, opacity: decided ? 0.3 : 1, cursor: decided ? 'default' : 'pointer' }}
                onClick={() => handleDecide('always_tool')}
                disabled={decided}
                onMouseEnter={e => { if (!decided) e.currentTarget.style.color = 'var(--ink-secondary)' }}
                onMouseLeave={e => { if (!decided) e.currentTarget.style.color = 'var(--ink-muted)' }}
                title={t('risk.alwaysToolTitle')}
              >
                ✓ {t('risk.alwaysTool')}
              </button>
              {toolName === 'terminal' && toolArgs && (
                <button
                  style={{ ...S.grantBtn, opacity: decided ? 0.3 : 1, cursor: decided ? 'default' : 'pointer' }}
                  onClick={() => handleDecide('always_command')}
                  disabled={decided}
                  onMouseEnter={e => { if (!decided) e.currentTarget.style.color = 'var(--ink-secondary)' }}
                  onMouseLeave={e => { if (!decided) e.currentTarget.style.color = 'var(--ink-muted)' }}
                  title={t('risk.alwaysCmdTitle')}
                >
                  ✓ {t('risk.alwaysCmd')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
