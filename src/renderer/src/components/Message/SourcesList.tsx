import React, { useState } from 'react'

export interface Source {
  title: string
  url?: string
}

export interface SourcesListProps {
  sources: Source[]
}

const WRAPPER: React.CSSProperties = {
  marginTop: '8px',
}

const TOGGLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--ink-muted)',
  fontSize: '11px',
  cursor: 'pointer',
  padding: '2px 0',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
}

const LIST: React.CSSProperties = {
  marginTop: '6px',
  padding: '8px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--line)',
  borderRadius: '8px',
}

const ITEM: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-secondary)',
  padding: '3px 0',
  lineHeight: '1.5',
}

const LINK: React.CSSProperties = {
  color: '#60a5fa',
  textDecoration: 'none',
  marginLeft: '4px',
}

export function SourcesList({ sources }: SourcesListProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={WRAPPER}>
      <button
        style={TOGGLE}
        onClick={() => setExpanded(v => !v)}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bg-page)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)' }}
      >
        {expanded ? '▾' : '▸'} {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div style={LIST}>
          {sources.map((s, i) => (
            <div key={i} style={ITEM}>
              {i + 1}. {s.title}
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={LINK}>
                  ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
