import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'
import type { ReasoningEvent } from './ReasoningTimeline'
import { MarkdownContent } from './ReasoningTimeline'

const ICONS = {
  browser: './icons/browser.svg', externalLink: './icons/external-link.svg',
  reasoning: './icons/reasoning-dot.svg', search: './icons/search.svg'
}

function IconImg({ src, size = 14 }: { src: string; size?: number }): React.JSX.Element {
  return <img src={src} alt="" style={{ width: size, height: size, flexShrink: 0 }} />
}

const ANIM_ID = 'ds-thinking-anims'
if (typeof document !== 'undefined' && !document.getElementById(ANIM_ID)) {
  const s = document.createElement('style')
  s.id = ANIM_ID
  s.textContent = '@keyframes dsNodeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'
  document.head.appendChild(s)
}

const LINE_COLOR = 'var(--solid)'
const LINE_LEFT = 0

const C = {
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', userSelect: 'none' as const } as React.CSSProperties,
  headerLogo: { width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, #4361EE, #7209B7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, color: 'var(--ink)' } as React.CSSProperties,
  headerText: { fontSize: 12, color: 'var(--ink-secondary)', fontWeight: 400 } as React.CSSProperties,
  headerArrow: { fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' } as React.CSSProperties,
  timeline: { padding: '0 12px 0 9px', position: 'relative' as const, userSelect: 'text' as const, WebkitUserSelect: 'text' as const } as React.CSSProperties,
  fullLine: { position: 'absolute' as const, left: LINE_LEFT, top: 8, bottom: 8, width: 1, background: LINE_COLOR } as React.CSSProperties,
  dashSeg: { position: 'absolute' as const, left: LINE_LEFT, top: -4, height: 21, width: 1, background: `repeating-linear-gradient(${LINE_COLOR} 0px, ${LINE_COLOR} 3px, transparent 3px, transparent 7px)` } as React.CSSProperties,
  node: { position: 'relative' as const, paddingBottom: 10, paddingTop: 4, paddingLeft: 8, animation: 'dsNodeIn 300ms ease-out forwards' } as React.CSSProperties,
  nodeIcon: { position: 'absolute' as const, left: -6, top: 5, width: 12, height: 12, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  nodeContent: { fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5, userSelect: 'text' as const, WebkitUserSelect: 'text' as const, textAlign: 'justify' as const } as React.CSSProperties,
  nodeTitle: { fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 2, userSelect: 'text' as const, WebkitUserSelect: 'text' as const, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'justify' as const } as React.CSSProperties,
  links: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 4, userSelect: 'text' as const, WebkitUserSelect: 'text' as const } as React.CSSProperties,
  linkChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-card)', fontSize: 11, color: 'rgba(124,58,237,0.8)', textDecoration: 'none' as const, transition: 'background 150ms ease', cursor: 'pointer', userSelect: 'text' as const, WebkitUserSelect: 'text' as const } as React.CSSProperties,
  codeBlock: { marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.2)', fontSize: 10, color: 'var(--ink-muted)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, fontFamily: 'SF Mono, Monaco, monospace', maxHeight: 150, overflowY: 'auto' as const, userSelect: 'text' as const, WebkitUserSelect: 'text' as const } as React.CSSProperties,
}

function openLink(url: string) { window.open(url, '_blank', 'noopener,noreferrer') }

function ThoughtNode({ event, dash }: { event: ReasoningEvent; dash?: boolean }): React.JSX.Element {
  return (
    <div style={C.node}>
      {dash && <div style={C.dashSeg} />}
      <span style={C.nodeIcon}><IconImg src={ICONS.reasoning} size={12} /></span>
      <div style={C.nodeContent}><MarkdownContent text={event.content} /></div>
    </div>
  )
}

function ToolNode({ event, hitsCount }: { event: ReasoningEvent; hitsCount?: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={C.node}>
      <span style={C.nodeIcon}><IconImg src={ICONS.search} size={12} /></span>
      <div>
        <div style={{ ...C.nodeTitle, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
          <span>{expanded ? '▾' : '▸'}</span>
          <span>{t('tp.execCmd', { name: event.name || 'tool' })}</span>
          {hitsCount !== undefined && hitsCount > 0 && (
            <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{t('tp.results', { n: hitsCount })}</span>
          )}
        </div>
        {expanded && (
          <pre style={C.codeBlock}>{event.content || t('tp.noArgs')}</pre>
        )}
      </div>
    </div>
  )
}

function BrowserNode({ event }: { event: ReasoningEvent }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const links = event.links || []
  return (
    <div style={C.node}>
      <span style={C.nodeIcon}><IconImg src={ICONS.browser} size={12} /></span>
      <div>
        <div style={{ ...C.nodeTitle, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
          <span>{expanded ? '▾' : '▸'}</span>
          <span>{t('tp.pages', { n: links.length })}</span>
        </div>
        {expanded && links.length > 0 && (
          <div style={C.links}>
            {links.map((l, i) => (
              <span key={i} onClick={(e) => { e.preventDefault(); openLink(l.url) }} style={C.linkChip}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--solid)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}>
                {l.favicon && <img src={l.favicon} alt="" style={{ width: 12, height: 12, borderRadius: 2 }} />}
                <span>{l.title?.substring(0, 30)}</span>
                <IconImg src={ICONS.externalLink} size={10} />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ObservationNode({ event }: { event: ReasoningEvent }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={C.node}>
      <span style={C.nodeIcon}><IconImg src={ICONS.externalLink} size={12} /></span>
      <div>
        <div style={{ ...C.nodeTitle, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
          <span>{expanded ? '▾' : '▸'}</span>
          <span>{t('tp.observe', { name: event.name || '' })}</span>
        </div>
        {expanded && (
          <div style={C.codeBlock}><MarkdownContent text={event.content} /></div>
        )}
      </div>
    </div>
  )
}

function ThinkingHeader({ elapsedSec, open, onToggle, streaming }: {
  elapsedSec?: number; open: boolean; onToggle: () => void; streaming: boolean
}): React.JSX.Element {
  // Live elapsed while streaming — a cold provider's first call can take ~1min
  // and a static "思考中..." reads as frozen.
  // ponytail: state must NOT be named `t` (shadows the i18n t import).
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!streaming) return
    setElapsed(0)
    const id = setInterval(() => setElapsed(x => x + 1), 1000)
    return () => clearInterval(id)
  }, [streaming])
  return (
    <div style={C.header} onClick={onToggle}>
      <div style={C.headerLogo}>AI</div>
      <span style={C.headerText}>{streaming ? t('tp.thinking', { s: elapsed }) : t('tp.thoughtSec', { n: elapsedSec ?? 0 })}</span>
      <span style={C.headerArrow}>{open ? '▼' : '▶'}</span>
    </div>
  )
}

export function ReasoningTimeline({ events, elapsedSec, streaming }: {
  events: ReasoningEvent[]; elapsedSec?: number; streaming: boolean
}): React.JSX.Element {
  // General setting: thinking card default open/collapsed (localStorage)
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('deskapp-general') || '{}').thinkingOpen !== false } catch { return true }
  })
  const browserEvents = events.filter(e => e.type === 'browser')

  return (
    <div>
      <ThinkingHeader elapsedSec={elapsedSec} open={open} onToggle={() => setOpen(!open)} streaming={streaming} />
      {open && events.length > 0 && (
        <div style={C.timeline}>
          <div style={C.fullLine} />
          {events.map((ev, i) => {
            if (ev.type === 'thought') return <ThoughtNode key={ev.id} event={ev} dash={i > 0} />
            if (ev.type === 'tool') {
              const matchingBrowsers = browserEvents.filter(b => {
                const ti = events.findIndex(e => e.id === ev.id)
                const bi = events.findIndex(e => e.id === b.id)
                return bi > ti && bi < (ti + 5)
              })
              const totalHits = matchingBrowsers.reduce((s, b) => s + (b.links?.length || 0), 0)
              return (
                <div key={ev.id}>
                  <ToolNode event={ev} hitsCount={totalHits} />
                  {matchingBrowsers.map(b => <BrowserNode key={b.id} event={b} />)}
                </div>
              )
            }
            if (ev.type === 'browser') return null
            if (ev.type === 'observation') return <ObservationNode key={ev.id} event={ev} />
            return null
          })}
        </div>
      )}
    </div>
  )
}
