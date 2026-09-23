import { useState, useEffect } from 'react'

interface VfsFile { name: string; path: string; size: number; ext: string; createdAt: number }
type ViewMode = 'list' | 'grid' | 'detail'

const extIcons: Record<string, string> = {
  ts: 'TS', tsx: 'TX', js: 'JS', json: '{}', md: 'MD', html: 'H', css: 'C',
  py: 'PY', rs: 'RS', go: 'GO', sh: 'SH', txt: 'TX', log: 'LG',
}
const fc: Record<string, string> = {
  ts: '#3178C6', tsx: 'var(--accent)', js: '#F7DF1E', json: 'var(--ok)', md: 'var(--accent)',
  html: 'var(--danger)', css: 'var(--accent-2)', py: '#3776AB', rs: '#EF8C2A', go: '#00ADD8', sh: '#1E1E1E',
}

export default function FileExplorer(): React.JSX.Element {
  const [files, setFiles] = useState<VfsFile[]>([])
  const [view, setView] = useState<ViewMode>('list')
  const [dir, setDir] = useState('')
  const rf = () => (window.deskAppAPI.getVfsFiles as any)().then(setFiles).catch(() => setFiles([]))
  useEffect(() => { ((window.deskAppAPI.getWorkspaceDir as any)()).then(setDir).catch(() => {}); rf() }, [])

  const btnStyle = (active: boolean) => ({
    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? 'var(--solid)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-muted)', fontSize: 11,
  })

  const openFile = (f: VfsFile) => (window.deskAppAPI.openVfsFile as any)?.(f.name)
  const cpPath = (e: React.MouseEvent, f: VfsFile) => { e.stopPropagation(); navigator.clipboard?.writeText(f.path) }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', color: 'var(--ink)' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', WebkitAppRegion: 'drag' as any, flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Workspace Files</span>
          {dir && <span style={{ fontSize: 10, color: 'var(--ink-faint)', marginLeft: 8 }}>{dir}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', WebkitAppRegion: 'no-drag' as any }}>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{files.length} files</span>
          <button onClick={() => setView('list')} style={btnStyle(view === 'list')}>List</button>
          <button onClick={() => setView('grid')} style={btnStyle(view === 'grid')}>Grid</button>
          <button onClick={() => setView('detail')} style={btnStyle(view === 'detail')}>Detail</button>
          <button onClick={rf} style={{ ...btnStyle(false), fontSize: 14 }}>Refresh</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {files.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--line-strong)', fontSize: 13 }}>
            <span style={{ fontSize: 40, marginBottom: 12 }}>[ ]</span>
            <span>Workspace empty</span>
            <span style={{ fontSize: 11, marginTop: 4, color: 'var(--solid)' }}>Agent output files will appear here</span>
          </div>
        )}
        {view === 'list' && files.map((f, i) => (
          <div key={i} onClick={() => openFile(f)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', cursor: 'pointer', borderBottom: '1px solid var(--bg-card)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <span style={{ fontSize: 11, fontWeight: 600, width: 28, textAlign: 'center', padding: '2px 6px', borderRadius: 4, background: (fc[f.ext] || 'var(--ink-muted)') + '30', color: fc[f.ext] || 'var(--ink-muted)', flexShrink: 0 }}>{extIcons[f.ext] || f.ext}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', width: 55, textAlign: 'right' }}>{formatSize(f.size)}</span>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', width: 65, textAlign: 'right' }}>{formatDate(f.createdAt)}</span>
          </div>
        ))}
        {view === 'grid' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '8px 16px' }}>
            {files.map((f, i) => (
              <div key={i} onClick={() => openFile(f)}
                style={{ width: 120, padding: 16, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-card)', textAlign: 'center', border: '1px solid var(--bg-card)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--line)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}>
                <div style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 4, background: (fc[f.ext] || 'var(--ink-muted)') + '30', color: fc[f.ext] || 'var(--ink-muted)', display: 'inline-block', marginBottom: 8 }}>{extIcons[f.ext] || f.ext}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              </div>
            ))}
          </div>
        )}
        {view === 'detail' && files.map((f, i) => (
          <div key={i} onClick={() => openFile(f)}
            style={{ padding: '10px 16px', borderBottom: '1px solid var(--bg-card)', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <span style={{ fontSize: 16, fontWeight: 700, padding: '4px 8px', borderRadius: 4, background: (fc[f.ext] || 'var(--ink-muted)') + '30', color: fc[f.ext] || 'var(--ink-muted)', flexShrink: 0 }}>{extIcons[f.ext] || f.ext}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 2, fontWeight: 500 }}>{f.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', display: 'flex', gap: 12 }}>
                <span>{formatSize(f.size)}</span>
                <span>{f.ext.toUpperCase()}</span>
                <span>{formatDate(f.createdAt)}</span>
                <span style={{ color: 'var(--line-strong)', cursor: 'pointer' }} onClick={e => cpPath(e, f)}>Copy Path</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string { if (bytes < 1024) return bytes + 'B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'; return (bytes / (1024 * 1024)).toFixed(1) + 'MB' }
function formatDate(ts: number): string { const d = new Date(ts); const n = new Date(); if (d.toDateString() === n.toDateString()) return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); return (d.getMonth() + 1) + '/' + d.getDate() }
