// ── TurnGroup — Data-driven thinking timeline (P0-8) ──
//
// Replaces the regex-based buildReasoningEvents (ReasoningTimeline.tsx:36-76)
// with AgentEvent-driven turn grouping. Instead of guessing thought/tool/
// observation from keyword patterns, tool nodes are built directly from
// tool.started/tool.finished events with correct name/args/result pairing.
//
// Collapsed state: "已思考 12s · 3 个工具"
// Expanded state: structured timeline nodes (thought → tool → result)

import { useState } from 'react'
import { t } from '../lib/i18n'
import type { AgentTurn, TurnTool, RiskClass } from '../../../shared/agent-events'
import { MarkdownContent, extractUrls } from './ReasoningTimeline'

// ── Icons (placeholder text until real icon system) ──

const ICONS: Record<string, string> = {
  thought: '💭',
  tool: '🔧',
  result: '📋',
  search: '🔍',
  browser: '🌐',
  terminal: '💻',
  file: '📄',
  error: '❌',
  done: '✅',
}

// ── Risk badge ──

function riskBadge(risk?: RiskClass): { icon: string; color: string; label: string } {
  switch (risk) {
    case 'read': return { icon: '👁', color: 'var(--ink-muted)', label: t('turn.read') }
    case 'write-low': return { icon: '✏️', color: 'var(--info)', label: t('turn.write') }
    case 'write-high': return { icon: '⚠️', color: 'var(--warn)', label: t('turn.important') }
    case 'destructive': return { icon: '🛑', color: 'var(--danger)', label: t('turn.danger') }
    default: return { icon: '', color: 'var(--ink-faint)', label: '' }
  }
}

// ── Styles ──

const S = {
  wrapper: {
    marginTop: 4,
    border: '1px solid var(--line)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    overflow: 'hidden' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: 11,
  } as React.CSSProperties,
  headerText: {
    color: 'var(--ink-muted)', flex: 1,
  } as React.CSSProperties,
  headerArrow: {
    color: 'var(--ink-faint)', fontSize: 10,
  } as React.CSSProperties,
  timeline: {
    padding: '0 10px 8px',
    borderTop: '1px solid var(--bg-card)',
  } as React.CSSProperties,
  stepRow: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '4px 0', fontSize: 11, lineHeight: 1.5,
    color: 'var(--ink-muted)',
  } as React.CSSProperties,
  stepStatus: {
    width: 14, flexShrink: 0, textAlign: 'center' as const,
    fontSize: 10, paddingTop: 1,
  } as React.CSSProperties,
  stepName: {
    color: 'var(--ink-faint)', flexShrink: 0,
    fontSize: 10, fontFamily: '"SF Mono", Monaco, monospace',
  } as React.CSSProperties,
  stepArgs: {
    flex: 1, wordBreak: 'break-word' as const,
    cursor: 'pointer',
  } as React.CSSProperties,
  stepResult: {
    padding: '4px 8px', marginTop: 2,
    background: 'rgba(0,0,0,0.2)', borderRadius: 4,
    fontSize: 10, color: 'var(--ink-muted)',
    maxHeight: 120, overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    fontFamily: '"SF Mono", Monaco, monospace',
  } as React.CSSProperties,
  riskChip: (color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 2,
    padding: '0 4px', borderRadius: 3,
    fontSize: 9, fontWeight: 600,
    color, background: `${color}15`,
    marginLeft: 4,
  } as React.CSSProperties),
  // streaming indicator
  streamingDot: {
    display: 'inline-block', width: 6, height: 6,
    borderRadius: '50%', background: 'var(--accent)',
    animation: 'pulse 1.2s ease-in-out infinite',
  } as React.CSSProperties,
  reasoningBlock: {
    padding: '6px 0',
    borderBottom: '1px solid var(--bg-card)',
  } as React.CSSProperties,
}

// ── StepRow — single tool call line ──

function StepRow({ tool, result }: { tool: TurnTool; result?: string }) {
  const [expanded, setExpanded] = useState(false)
  const rb = riskBadge(tool.risk)
  const icon = tool.done ? ICONS.done : ICONS.tool

  return (
    <div>
      <div style={S.stepRow}>
        <span style={S.stepStatus}>
          {tool.done ? <span style={{ color: 'var(--ok)' }}>●</span> :
           <span style={{ opacity: 0.6 }}>○</span>}
        </span>
        <span style={{ ...S.stepName, color: tool.done ? 'var(--ink-muted)' : 'var(--ink-faint)' }}>
          {tool.name}
        </span>
        <span style={S.stepArgs} onClick={() => setExpanded(!expanded)}>
          <span>{expanded ? '▾' : '▸'} </span>
          <span style={{ opacity: 0.7 }}>{tool.args.slice(0, 80)}{tool.args.length > 80 ? '…' : ''}</span>
          {rb.icon && <span style={S.riskChip(rb.color)}>{rb.icon}{rb.label}</span>}
        </span>
      </div>
      {expanded && (result || tool.result) && (
        <div style={S.stepResult}>
          <MarkdownContent text={(result || tool.result || '').slice(0, 1000)} />
        </div>
      )}
    </div>
  )
}

// ── Reasoning block ──

function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!text.trim()) return null

  return (
    <div style={S.reasoningBlock}>
      <div style={{ ...S.header, borderBottom: 'none', padding: '2px 0 2px' }}
           onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        <span style={S.headerText}>{t('turn.reasoning')}</span>
      </div>
      {expanded && (
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', padding: '0 0 4px 16px', lineHeight: 1.5 }}>
          <MarkdownContent text={text} />
        </div>
      )}
    </div>
  )
}

// ── Main component ──

export interface TurnGroupProps {
  turn: AgentTurn
  /** Tool results keyed by position index (for live streaming match) */
  activeResult?: string
}

export function TurnGroup({ turn }: TurnGroupProps) {
  const [open, setOpen] = useState(true) // open by default for live turns
  const toolCount = turn.tools.length
  const doneTools = turn.tools.filter(t => t.done).length
  const failedTools = turn.tools.filter(t => t.done && t.result && /error|Error/i.test(t.result)).length
  const elapsedSec = turn.meta?.elapsedMs ? Math.round(turn.meta.elapsedMs / 1000) : undefined
  const hasContent = turn.reasoning.length > 0 || toolCount > 0

  if (!hasContent && !turn.text) return null

  const summaryParts: string[] = []
  if (elapsedSec) summaryParts.push(t('turn.took', { s: elapsedSec }))
  if (toolCount > 0) {
    const status = turn.streaming
      ? t('turn.doneTools', { done: doneTools, total: toolCount })
              : t('turn.toolsN', { n: toolCount })
    summaryParts.push(status)
  }
  if (turn.meta?.model) summaryParts.push(turn.meta.model)

  return (
    <div style={S.wrapper}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      {/* Header row */}
      <div style={S.header} onClick={() => setOpen(!open)}>
        {turn.streaming && <span style={S.streamingDot} />}
        <span style={S.headerText}>
          {turn.streaming ? t('turn.thinking') : `${t('turn.thought', { parts: '' })}${summaryParts.join(' · ')}`}
        </span>
        <span style={S.headerArrow}>{open ? '▼' : '▶'}</span>
      </div>

      {/* Expanded timeline */}
      {open && (
        <div style={S.timeline}>
          {/* Reasoning text (if any) */}
          {turn.reasoning && <ReasoningBlock text={turn.reasoning} />}

          {/* Tool steps */}
          {turn.tools.map((tool, i) => (
            <StepRow key={`${tool.name}-${i}`} tool={tool} />
          ))}

          {/* Error display */}
          {turn.error && (
            <div style={{ ...S.stepRow, color: 'var(--danger)', fontSize: 10 }}>
              ❌ {turn.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Factory: build TurnGroup props from raw BubbleApp data (transition) ──

export interface TurnGroupRawData {
  reasoningChunks: { id: string; content: string }[]
  toolCalls: { id: string; name: string; args: string }[]
  toolResults: { id: string; name: string; content: string }[]
  streaming: boolean
  elapsedSec?: number
  model?: string
  via?: string
}

/**
 * Build a synthetic AgentTurn from the legacy BubbleApp data structures.
 * This is the migration bridge — after full P0-1 adoption, BubbleApp will
 * use assembleTurns() directly and this function can be removed.
 */
export function turnGroupFromRawData(data: TurnGroupRawData): AgentTurn {
  const turnId = `turn-legacy-${Date.now()}`
  const reasoning = data.reasoningChunks.map(r => r.content).join('')
  const answer = ''

  const tools: TurnTool[] = []
  for (const tc of data.toolCalls) {
    const tr = data.toolResults.find(r => r.name === tc.name)
    tools.push({
      name: tc.name,
      args: tc.args || '{}',
      result: tr?.content,
      done: !!tr,
    })
  }
  // Also add tool results that didn't have a matching call
  for (const tr of data.toolResults) {
    if (!tools.find(t => t.name === tr.name && !t.done)) {
      tools.push({ name: tr.name, args: '{}', result: tr.content, done: true })
    }
  }

  return {
    turnId,
    events: [],
    reasoning,
    answer,
    streaming: data.streaming,
    tools,
    meta: {
      model: data.model,
      via: data.via,
      elapsedMs: data.elapsedSec ? data.elapsedSec * 1000 : undefined,
    },
  }
}
