import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'
import type { ReasoningEvent } from './ReasoningTimeline'
import { extractUrls } from './ReasoningTimeline'

interface DashboardProps {
  events: ReasoningEvent[]
  assistantContent?: string
  taskText?: string
  taskSuccess?: boolean
  status?: SessionStatus
}

// ── Types from agent-stats ──
interface ToolRecord { name: string; startTime: number; duration: number; success: boolean }
interface ErrorPattern { pattern: string; count: number; lastSeen: number; suggestion: string }
interface AttemptRecord { task: string; attempt: number; approach: string; success: boolean; timestamp: number }
interface ContextBullet { id: string; description: string; createdAt: number }
interface DecisionRecord { editTarget: string; prediction: string; actual: string; verified: boolean }
interface CapabilityScore { name: string; score: number; maxScore: number; updatedAt: number }
interface AgentStats {
  toolHistory: ToolRecord[]; errorPatterns: ErrorPattern[]; attemptLog: AttemptRecord[]
  contextLogbook: ContextBullet[]; decisionLog: DecisionRecord[]; capabilityScores: CapabilityScore[]
  totalTasks: number; successTasks: number
}

// ── Styles ──
const DS = {
  container: {
    marginBottom: 12, borderRadius: 10, overflow: 'hidden' as const,
    border: '1px solid var(--bg-card)', background: 'var(--bg-card)',
    fontSize: 10, userSelect: 'text' as const, WebkitUserSelect: 'text' as const
  } as React.CSSProperties,
  row: {
    padding: '5px 10px', borderBottom: '1px solid var(--bg-card)',
    display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center'
  } as React.CSSProperties,
  sectionHeader: {
    padding: '5px 10px', borderBottom: '1px solid var(--bg-card)',
    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    color: 'var(--ink-faint)', fontSize: 10, fontWeight: 500, userSelect: 'none' as const
  } as React.CSSProperties,
  chip: (bg: string, c?: string) => ({
    padding: '2px 6px', borderRadius: 4, fontSize: 9, background: bg,
    color: c || 'var(--ink-secondary)', whiteSpace: 'nowrap' as const
  } as React.CSSProperties),
  link: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
    borderRadius: 4, background: 'var(--bg-card)', fontSize: 10,
    color: 'rgba(124,58,237,0.7)', textDecoration: 'none' as const, cursor: 'pointer'
  } as React.CSSProperties,
  bar: (ratio: number, color: string) => ({
    height: 3, borderRadius: 2, background: color,
    width: `${Math.min(100, ratio * 100)}%`, transition: 'width 300ms ease'
  } as React.CSSProperties),
}

function open(url: string) { window.open(url, '_blank', 'noopener,noreferrer') }
function extractFiles(text: string): { name: string; ext: string }[] {
  const re = /(?:`|\b\/?)([a-zA-Z0-9_\-.]+\.(?:tsx?|jsx?|json|md|html|css|py|rs|go|yaml|yml|toml|sh|txt|csv|log))(?:`|\b)/g
  const seen = new Set<string>()
  const res: { name: string; ext: string }[] = []
  let m; while ((m = re.exec(text)) !== null)
    if (!seen.has(m[1]) && m[1].length < 50) { seen.add(m[1]); res.push({ name: m[1], ext: m[1].split('.').pop() || '' }) }
  return res.slice(0, 10)
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ── Feature 1: Failure Mode Clustering ──
function FailureCluster({ patterns }: { patterns: ErrorPattern[] }) {
  if (patterns.length === 0) return null
  const top = [...patterns].sort((a, b) => b.count - a.count).slice(0, 5)
  return (
    <div style={DS.row}>
      <span style={{ color: 'var(--danger)', fontSize: 9, fontWeight: 500 }}>{t('ap.failMode')}</span>
      {top.map((p, i) => (
        <span key={i} style={DS.chip('var(--danger-soft)', 'var(--danger)')} title={p.suggestion}>
          {p.pattern} (×{p.count})
        </span>
      ))}
    </div>
  )
}

// ── Feature 2: Execution Timeline (collapsed by default — click to expand) ──
function ExecutionTimeline({ toolHistory }: { toolHistory: ToolRecord[] }) {
  const [open, setOpen] = useState(false)
  const recent = toolHistory.slice(0, 10)
  if (recent.length === 0) return null
  const maxDur = Math.max(...recent.map(t => t.duration), 1)
  const totalMs = recent.reduce((s, t) => s + t.duration, 0)
  const okCount = recent.filter(t => t.success).length
  return (
    <div>
      <div
        style={{ ...DS.row, cursor: 'pointer', userSelect: 'none' as const }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ color: 'var(--ink-faint)', fontSize: 9 }}>{t('ap.tools')}</span>
        <span style={DS.chip('var(--accent-2-soft)', 'rgba(6,182,212,0.5)')}>
          {t('ap.toolsStats', { n: recent.length, ok: okCount, ms: formatMs(totalMs) })}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && recent.slice(0, 6).map((item, i) => (
        <div key={i} style={{ padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 9 }}>
          <span style={{ color: item.success ? 'rgba(16,185,129,0.6)' : 'var(--danger)', width: 10 }}>{item.success ? '✓' : '✗'}</span>
          <span style={{ color: 'var(--ink-muted)', width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          <span style={{ flex: 1 }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 2, height: 6, overflow: 'hidden' }}>
              <div style={DS.bar(item.duration / maxDur, item.success ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)')} />
            </div>
          </span>
          <span style={{ color: 'var(--ink-faint)', width: 45, textAlign: 'right' }}>{formatMs(item.duration)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Feature 3: Attempt Evolution Log ──
function AttemptEvolution({ attempts }: { attempts: AttemptRecord[] }) {
  const groups = new Map<string, AttemptRecord[]>()
  for (const a of attempts) {
    const k = a.task.substring(0, 30)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(a)
  }
  if (groups.size === 0) return null
  const entries = [...groups.entries()].filter(([_, v]) => v.length > 1).slice(0, 3)
  if (entries.length === 0) return null

  return (
    <div>
      <div style={DS.row}>
        <span style={{ color: 'var(--ink-faint)', fontSize: 9 }}>{t('ap.evolve')}</span>
      </div>
      {entries.map(([task, recs]) => (
        <div key={task} style={{ padding: '2px 10px 4px', fontSize: 9, color: 'var(--ink-faint)' }}>
          <div style={{ marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {recs.map((r, j) => (
              <span key={j} style={DS.chip(r.success ? 'rgba(16,185,129,0.1)' : 'var(--danger-soft)', r.success ? 'var(--ok)' : 'var(--danger)')}>
                #{r.attempt} {r.success ? '✓' : '✗'}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Feature 4: Context Logbook (ACE) ──
function ContextLogbook({ bullets }: { bullets: ContextBullet[] }) {
  const recent = bullets.slice(-8).reverse()
  if (recent.length === 0) return null
  return (
    <div>
      <div style={DS.row}>
        <span style={{ color: 'var(--ink-faint)', fontSize: 9 }}>{t('ap.aceLog')}</span>
      </div>
      <div style={{ padding: '2px 10px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {recent.map(b => (
          <span key={b.id} style={DS.chip('var(--accent-soft)', 'var(--accent-line)')} title={b.description}>
            {b.description.substring(0, 40)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Feature 5: Self-Check Predictions ──
function SelfCheckPanel({ decisions }: { decisions: DecisionRecord[] }) {
  const recent = decisions.slice(0, 5)
  if (recent.length === 0) return null
  return (
    <div>
      <div style={DS.row}>
        <span style={{ color: 'var(--ink-faint)', fontSize: 9 }}>{t('ap.selfCheck')}</span>
        <span style={DS.chip('var(--warn-soft)', 'var(--warn)')}>
          {t('ap.accuracy', { p: Math.round(recent.filter(d => d.verified).length / recent.length * 100) })}
        </span>
      </div>
      {recent.map((d, i) => (
        <div key={i} style={{ padding: '1px 10px', fontSize: 9, color: 'var(--ink-faint)', display: 'flex', gap: 6 }}>
          <span>{d.verified ? '✓' : '✗'}</span>
          <span style={{ color: 'var(--ink-muted)' }}>{d.editTarget}</span>
        </div>
      ))}
    </div>
  )
}

// ── Feature 6: Risk Confirmation ──
function RiskPanel({ events }: { events: ReasoningEvent[] }) {
  const risky = events.filter(e => e.type === 'tool' && e.name?.match(/terminal|bash|exec|sudo|rm|delete|format/))
  if (risky.length === 0) return null
  return (
    <div style={DS.row}>
      <span style={{ color: 'var(--warn)', fontSize: 9 }}>{t('ap.risky')}</span>
      {risky.map((r, i) => (
        <span key={i} style={DS.chip('var(--warn-soft)', 'var(--warn)')}>
          {t('ap.autoAllow', { name: r.name })}
        </span>
      ))}
    </div>
  )
}

// ── Feature 7: Capability Scorecard ──
function Scorecard({ scores, totalTasks, successTasks }: { scores: CapabilityScore[]; totalTasks: number; successTasks: number }) {
  const successRate = totalTasks > 0 ? Math.round(successTasks / totalTasks * 100) : 0
  return (
    <div>
      <div style={DS.row}>
        <span style={{ color: 'var(--ink-faint)', fontSize: 9 }}>{t('ap.score')}</span>
        <span style={DS.chip(successRate > 70 ? 'rgba(16,185,129,0.1)' : successRate > 40 ? 'var(--warn-soft)' : 'var(--danger-soft)', successRate > 70 ? 'var(--ok)' : successRate > 40 ? 'var(--warn)' : 'var(--danger)')}>
          {t('ap.successRate', { p: successRate })}
        </span>
      </div>
      {scores.length > 0 && (
        <div style={{ padding: '2px 10px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {scores.map((s, i) => (
            <span key={i} style={DS.chip('var(--bg-card)', 'var(--ink-muted)')}>
              {s.name}: {s.score}/{s.maxScore}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Feature 8: Session status line (like the hermes TUI status bar) ──
export interface SessionStatus {
  model?: string
  usedTokens: number
  lastTurnMs: number
  totalTurnMs: number
  sessionStartTs: number
}

// Context windows per model. kimi-k3 实测 262.1K；deepseek 值待官方价目校准。
const CONTEXT_LIMITS: Record<string, number> = {
  'kimi-k3': 262_144,
  'deepseek-v4-pro': 131_072,
  'deepseek-v4-flash': 131_072,
}

function fmtK(n: number): string {
  if (n < 1000) return String(n)
  const v = n / 1000
  return `${v >= 100 ? v.toFixed(1) : Math.round(v)}K`
}

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function StatusLine({ status }: { status: SessionStatus }) {
  if (!status.model) return null
  const limit = CONTEXT_LIMITS[status.model] ?? 131_072
  const ratio = Math.min(1, status.usedTokens / limit)
  const pct = Math.round(ratio * 100)
  const filled = Math.round(ratio * 10)
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  const age = Date.now() - status.sessionStartTs
  const barColor = pct > 80 ? 'var(--danger)' : pct > 60 ? 'rgba(245,158,11,0.6)' : 'var(--ok)'
  return (
    <div style={{ ...DS.row, fontFamily: 'SF Mono, Monaco, monospace', fontSize: 9, color: 'var(--ink-muted)', gap: 4 }}>
      <span style={{ color: 'var(--ink-muted)' }}>{status.model}</span>
      <span style={{ color: 'var(--line-strong)' }}>│</span>
      <span>{fmtK(status.usedTokens)}/{fmtK(limit)}</span>
      <span style={{ color: 'var(--line-strong)' }}>│</span>
      <span style={{ color: barColor }}>[{bar}] {pct}%</span>
      <span style={{ color: 'var(--line-strong)' }}>│</span>
      <span>{t('ap.session', { age: fmtAge(age) })}</span>
      {status.lastTurnMs > 0 && (
        <>
          <span style={{ color: 'var(--line-strong)' }}>│</span>
          <span>⏲ {fmtAge(status.lastTurnMs)}</span>
        </>
      )}
      {status.totalTurnMs > 0 && (
        <>
          <span style={{ color: 'var(--line-strong)' }}>│</span>
          <span>✓ {fmtAge(status.totalTurnMs)}</span>
        </>
      )}
    </div>
  )
}

// ── Main Dashboard ──
export function AgentDashboard({ events, assistantContent, taskText, taskSuccess, status }: DashboardProps): React.JSX.Element | null {
  const [stats, setStats] = useState<AgentStats | null>(null)

  useEffect(() => {
    try { window.deskAppAPI.getAgentStats?.().then(setStats) } catch {}
  }, [events.length])

  const toolCount = events.filter(e => e.type === 'tool').length
  const browserCount = events.filter(e => e.type === 'browser').length
  const thoughtCount = events.filter(e => e.type === 'thought').length
  const allUrls = extractUrls(assistantContent || '')
  const files = extractFiles(assistantContent || '')
  const total = toolCount + browserCount + thoughtCount
  const statsAvailable = stats || null

  // Hooks must be at top level (before any conditional return)
  const [expandSection, setExpandSection] = useState<string | null>(null)

  // Render when there's anything to show — including just the status line
  // (status.model is set at turn START, so the line renders during the reply
  // even before any tool events or stats exist).
  if (total === 0 && allUrls.length === 0 && files.length === 0 && !statsAvailable && !status?.model) return null

  return (
    <div style={DS.container}>
      {/* ── Quick stats ── */}
      {total > 0 && (
        <div style={DS.row}>
          <span style={{ color: 'var(--ink-faint)' }}>{t('ap.steps', { n: total })}</span>
          {thoughtCount > 0 && <span style={{ ...DS.chip('var(--accent-soft)', 'var(--accent-line)'), cursor: 'pointer' }} onClick={() => setExpandSection(expandSection === 'plan' ? null : 'plan')}>📋 {thoughtCount}（点击展开）{expandSection === 'plan' ? ' ▲' : ' ▼'}</span>}
          {toolCount > 0 && <span style={{ ...DS.chip('rgba(6,182,212,0.15)', 'rgba(6,182,212,0.5)'), cursor: 'pointer' }} onClick={() => setExpandSection(expandSection === 'tool' ? null : 'tool')}>⚡ {toolCount}（点击展开）{expandSection === 'tool' ? ' ▲' : ' ▼'}</span>}
          {browserCount > 0 && <span style={DS.chip('rgba(16,185,129,0.15)', 'var(--ok)')}>🌐 {browserCount}（网页浏览）</span>}
        </div>
      )}

      {expandSection === 'plan' && (
        <div style={{ padding: '4px 10px 8px', maxHeight: 200, overflowY: 'auto' as const, borderBottom: '1px solid var(--bg-card)' }}>
          {events.filter(e => e.type === 'thought').slice(0, 15).map((e, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid var(--accent-line)', userSelect: 'text' as const, WebkitUserSelect: 'text' as const }}>
              {e.content.substring(0, 200)}
            </div>
          ))}
        </div>
      )}
      {expandSection === 'tool' && (
        <div style={{ padding: '4px 10px 8px', maxHeight: 200, overflowY: 'auto' as const, borderBottom: '1px solid var(--bg-card)' }}>
          {events.filter(e => e.type === 'tool').map((e, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid rgba(6,182,212,0.2)', userSelect: 'text' as const, WebkitUserSelect: 'text' as const }}>
              <div style={{ color: 'rgba(6,182,212,0.6)', fontWeight: 500 }}>{e.name || 'tool'}</div>
              <div>{e.content.substring(0, 200)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Feature 6: Risk Panel */}
      <RiskPanel events={events} />

      {/* Feature 2: Execution Timeline */}
      {stats && stats.toolHistory.length > 0 && (
        <ExecutionTimeline toolHistory={stats.toolHistory} />
      )}

      {/* Feature 1: Failure Clustering */}
      {stats && stats.errorPatterns.length > 0 && (
        <FailureCluster patterns={stats.errorPatterns} />
      )}

      {/* Feature 3: Attempt Evolution */}
      {stats && stats.attemptLog.length > 0 && (
        <AttemptEvolution attempts={stats.attemptLog} />
      )}

      {/* Feature 4: ACE Logbook */}
      {stats && stats.contextLogbook.length > 0 && (
        <ContextLogbook bullets={stats.contextLogbook} />
      )}

      {/* Feature 5: Self-Check */}
      {stats && stats.decisionLog.length > 0 && (
        <SelfCheckPanel decisions={stats.decisionLog} />
      )}

      {/* Inline links */}
      {allUrls.length > 0 && (
        <div style={DS.row}>
          {allUrls.slice(0, 5).map((u, i) => (
            <span key={i} onClick={() => open(u.url)} style={DS.link}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--solid)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}>
              {u.title.substring(0, 24)} ↗
            </span>
          ))}
        </div>
      )}

      {/* Feature 7: Scorecard */}
      {stats && (
        <Scorecard scores={stats.capabilityScores} totalTasks={stats.totalTasks} successTasks={stats.successTasks} />
      )}

      {/* Feature 8: session status line (hermes TUI style) */}
      {status && <StatusLine status={status} />}
    </div>
  )
}
