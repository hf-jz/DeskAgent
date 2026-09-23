// ── Create workspace (phase-1/2 MVP): tree + editable deck + property panel ──
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { chartSvg, parseChart } from '../../../shared/chart-svg'

interface TreeItem { name: string; path: string; isDir: boolean }
interface Block { id: string; kind: 'text' | 'image' | 'table' | 'chart' | 'component'; content: string; size?: number; color?: string }

const csvRows = (csv: string): string[][] =>
  csv.split('\n').slice(0, 30).map(l => l.split(/[,，\t]/).map(c => c.replace(/^"|"$/g, '').trim())).filter(r => r.some(Boolean))

const EMERALD = '#34d399'
const BG = '#0b0f14'
const PANEL = 'rgba(255,255,255,0.05)'
const EDGE = 'rgba(255,255,255,0.14)'
const INK = '#e8edf2'
const MUTED = 'rgba(255,255,255,0.45)'

export default function CreateApp(): React.JSX.Element {
  const sub = new URLSearchParams(window.location.search).get('sub')
  if (sub === 'style') return <StyleSub />
  if (sub === 'material') return <MaterialSub />
  if (sub === 'export') return <ExportSub />

  const [payload, setPayload] = useState<{ source: string; title: string; type: string } | null>(null)
  const [tree, setTree] = useState<TreeItem[]>([])
  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [skills, setSkills] = useState<{ templates: { id: string; label: string }[]; elements: { kind: string; label: string; snippet: string }[] }>({ templates: [], elements: [] })
  const [templateId, setTemplateId] = useState<string>('')
  const [format, setFormat] = useState<'html' | 'pdf' | 'pptx'>('html')
  const [outDir, setOutDir] = useState('')
  const [themeColor, setThemeColor] = useState('#ff6a3d')
  const [themeFont, setThemeFont] = useState('')

  useEffect(() => {
    window.deskAppAPI.getCreatePayload().then((p: any) => {
      if (!p) return
      setPayload(p); setTitle(p.title || t('create.workTitle')); setOutDir(p.source || '')
      if (p.source) {
        window.deskAppAPI.scanCreateDir(p.source).then((items: any) => setTree(items || []))
        window.deskAppAPI.loadCreateState(p.source).then((st: any) => {
          if (st) { setTitle(st.title || p.title); setBlocks(st.blocks || []); if (st.templateId) setTemplateId(st.templateId); if (st.themeColor) setThemeColor(st.themeColor); if (st.themeFont !== undefined) setThemeFont(st.themeFont) }
        })
      }
    })
    window.deskAppAPI.getCreateSkills().then((s: any) => {
      setSkills(s || { templates: [], elements: [] }); if (s?.templates?.[0]) setTemplateId(s.templates[0].id)
    })
  }, [])

  // Auto-save the workspace state (debounced) — reopen restores exactly.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!payload?.source) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.deskAppAPI.saveCreateState({ dir: payload.source, state: { title, blocks, templateId, themeColor, themeFont } })
    }, 600)
  }, [title, blocks, templateId, themeColor, themeFont, payload])

  // Sub-window edits → live refresh (push, no focus round-trip)
  useEffect(() => {
    return window.deskAppAPI.onCreateRefresh(() => {
      if (!payload?.source) return
      window.deskAppAPI.loadCreateState(payload.source).then((st: any) => {
        if (st) { setTitle(st.title || title); setBlocks(st.blocks || []); if (st.templateId) setTemplateId(st.templateId); if (st.themeColor) setThemeColor(st.themeColor); if (st.themeFont !== undefined) setThemeFont(st.themeFont) }
      })
    })
  }, [payload])

  // Sub-window edits land in the state JSON — reload on focus so the main
  // work window reflects style/material/export changes immediately.
  useEffect(() => {
    const onFocus = () => {
      if (!payload?.source) return
      window.deskAppAPI.loadCreateState(payload.source).then((st: any) => {
        if (st) { setTitle(st.title || title); setBlocks(st.blocks || []); if (st.templateId) setTemplateId(st.templateId) }
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [payload])

  const addBlock = (kind: 'text' | 'image' | 'table' | 'chart' | 'component', content: string) =>
    setBlocks(b => [...b, { id: 'b' + Date.now() + Math.random().toString(36).slice(2, 4), kind, content }])

  const addChart = (type: 'bar' | 'line') => addBlock('chart', `${type}\n${t('create.chartDataSample')}`)
  const addComponent = (snippet: string) => addBlock('component', snippet)
  const addAscii = () => addBlock('component', '::ascii::DESKAPP')

  const addFromPath = async (path: string) => {
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
    if (isImg) addBlock('image', path)
    else if (/\.(csv)$/i.test(path)) {
      const text = await window.deskAppAPI.readCreateFile(path)
      if (text) addBlock('table', text.slice(0, 8000))
    } else if (/\.(md|txt)$/i.test(path)) {
      const text = await window.deskAppAPI.readCreateFile(path)
      if (text) addBlock('text', text.slice(0, 2000))
    }
  }

  const onTreeClick = async (it: TreeItem) => {
    if (it.isDir) { setTree(await window.deskAppAPI.scanCreateDir(it.path)); return }
    addFromPath(it.path)
  }

  const exportIt = async () => {
    if (!payload) return
    const path = await window.deskAppAPI.exportCreate({ title, blocks, format, dir: outDir || payload.source, templateId, themeColor, themeFont })
    setStatus(path ? t('create.exported', { path }) : t('create.exportFail'))
  }

  const sel = blocks.find(b => b.id === selected)
  const patchSel = (p: Partial<Block>) => setBlocks(bs => bs.map(b => b.id === selected ? { ...b, ...p } : b))

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: INK }
  const btn: React.CSSProperties = { background: 'rgba(52,211,153,0.15)', border: `1px solid ${EMERALD}`, color: EMERALD, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  const field: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: MUTED, marginBottom: 8 }
  const selStyle: React.CSSProperties = { background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 11, padding: '4px 6px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: INK }}>
      {/* Title bar — work-window chrome: traffic lights + drag + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${EDGE}`, WebkitAppRegion: 'drag' as any }}>
        <div data-ntd style={{ display: 'flex', gap: 7, WebkitAppRegion: 'no-drag' as any }}>
          <span onClick={() => window.deskAppAPI.createWinClose()} title={t('create.close')} style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer' }} />
          <span onClick={() => window.deskAppAPI.createWinMinimize()} title={t('create.minimize')} style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', cursor: 'pointer' }} />
          <span onClick={() => window.deskAppAPI.createWinMaximize()} title={t('create.maximize')} style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', cursor: 'pointer' }} />
        </div>
        <span style={{ fontSize: 13, color: MUTED }}>{t('create.title')}</span>
        <input value={title} onChange={e => setTitle(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', color: INK, fontSize: 15, fontWeight: 700, outline: 'none', WebkitAppRegion: 'no-drag' as any }} />
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={selStyle} title="风格模板">
          {skills.templates.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={format} onChange={e => setFormat(e.target.value as 'html' | 'pdf' | 'pptx')} style={selStyle}>
          <option value="html">HTML</option><option value="pdf">PDF</option><option value="pptx">PPTX</option>
        </select>
        <button style={btn} onClick={exportIt}>{t('create.export')}</button>
        <button style={{ ...btn, background: 'rgba(96,165,250,0.1)', borderColor: '#60a5fa', color: '#60a5fa' }} onClick={() => payload?.source && window.deskAppAPI.openCreateSub('style', payload.source)}>风格</button>
        <button style={{ ...btn, background: 'rgba(96,165,250,0.1)', borderColor: '#60a5fa', color: '#60a5fa' }} onClick={() => payload?.source && window.deskAppAPI.openCreateSub('material', payload.source)}>素材</button>
        <button style={{ ...btn, background: 'rgba(96,165,250,0.1)', borderColor: '#60a5fa', color: '#60a5fa' }} onClick={() => payload?.source && window.deskAppAPI.openCreateSub('export', payload.source)}>导出…</button>
        <button style={{ ...btn, background: 'rgba(96,165,250,0.12)', borderColor: '#60a5fa', color: '#60a5fa' }}
          title={t('create.searchSkillsHint')}
          onClick={() => {
            window.deskAppAPI.writeClipboard(t('create.searchSkillsClip'))
            window.deskAppAPI.openBubble()
          }}>{t('create.searchSkills')}</button>
        <button style={{ ...btn, background: 'rgba(244,114,182,0.12)', borderColor: '#f472b6', color: '#f472b6' }}
          title={t('create.genVideoHint')}
          onClick={() => {
            window.deskAppAPI.writeClipboard(`用 ~/web/hyperframes 的 hyperframes 技能，把以下创作内容做成宣传视频：标题「${title}」，素材目录 ${payload?.source || ''}（含 .deskapp-create.json 的块结构）。按 SKILL.md 工作流生成构图并渲染 MP4，渲染完告诉我产物路径。`)
            window.deskAppAPI.openBubble()
          }}>{t('create.genVideo')}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', borderBottom: `1px solid ${EDGE}`, fontSize: 11, color: MUTED }}>
        <span>{t('create.outDir')}</span>
        <input value={outDir} onChange={e => setOutDir(e.target.value)} style={{ flex: 1, background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 11, padding: '3px 8px', outline: 'none' }} />
        {status && <span style={{ color: EMERALD }}>{status}</span>}
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Material tree */}
        <div style={{ width: 210, borderRight: `1px solid ${EDGE}`, overflowY: 'auto', padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: MUTED, margin: '0 0 8px', wordBreak: 'break-all' }}>📂 {payload?.source || ''}</div>
          {tree.map(it => (
            <div key={it.path} style={row} onClick={() => onTreeClick(it)} title={it.path}
              draggable={!it.isDir}
              onDragStart={e => { e.dataTransfer.setData('text/plain', it.path); e.dataTransfer.effectAllowed = 'copy' }}>
              <span>{it.isDir ? '📁' : '📄'}</span>
              <span style={{ color: it.isDir ? EMERALD : INK }}>{it.name}</span>
            </div>
          ))}
          {tree.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>{t('create.dirEmpty')}</div>}
          <div style={{ fontSize: 11, color: MUTED, marginTop: 12 }}>{t('create.dropHint')}</div>
        </div>
        {/* Canvas */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}
          onDragOver={e => { e.preventDefault() }}
          onDrop={e => { e.preventDefault(); const p = e.dataTransfer.getData('text/plain'); if (p) addFromPath(p) }}>
          <h1 contentEditable suppressContentEditableWarning onBlur={e => setTitle(e.currentTarget.textContent || '')}
            style={{ fontSize: 40, color: EMERALD, margin: '0 0 20px', outline: 'none', borderBottom: `2px solid ${EDGE}`, paddingBottom: 10 }}>
            {title}
          </h1>
          {blocks.map(b => (
            <div key={b.id} onClick={() => setSelected(b.id)}
              style={{ position: 'relative', background: PANEL, border: `1px solid ${selected === b.id ? EMERALD : EDGE}`, borderRadius: 14, padding: 18, margin: '12px 0', cursor: 'pointer' }}>
              {b.kind === 'image'
                ? <img src={`file://${b.content}`} style={{ maxWidth: '100%', maxHeight: b.size || 320, borderRadius: 10 }} alt="" />
                : b.kind === 'component'
                  ? <div dangerouslySetInnerHTML={{ __html: b.content }} />
                  : b.kind === 'chart'
                  ? <div dangerouslySetInnerHTML={{ __html: chartSvg(b.content) }} />
                  : b.kind === 'table'
                  ? <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      {csvRows(b.content).map((r, i) => (
                        <tr key={i}>{r.map((c, j) => (
                          <td key={j} style={{ border: `1px solid ${EDGE}`, padding: '6px 10px', background: i === 0 ? 'rgba(52,211,153,0.08)' : 'transparent', color: i === 0 ? EMERALD : INK, fontWeight: i === 0 ? 700 : 400 }}>{c}</td>
                        ))}</tr>
                      ))}
                    </table>
                  : <div contentEditable suppressContentEditableWarning
                    onBlur={e => setBlocks(bs => bs.map(x => x.id === b.id ? { ...x, content: e.currentTarget.textContent || '' } : x))}
                    style={{ whiteSpace: 'pre-wrap', outline: 'none', fontSize: b.size || 14, color: b.color || INK, lineHeight: 1.7 }}>{b.content}</div>}
              <button onClick={e => { e.stopPropagation(); setBlocks(bs => bs.filter(x => x.id !== b.id)); setSelected(null) }}
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,95,87,0.15)', border: '1px solid #ff5f57', color: '#ff5f57', borderRadius: 6, fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>{t('create.remove')}</button>
            </div>
          ))}
          {blocks.length === 0 && <div style={{ color: MUTED, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>{t('create.canvasEmpty')}</div>}
        </div>
        {/* Property panel */}
        <div style={{ width: 170, borderLeft: `1px solid ${EDGE}`, padding: 14, flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('create.elements')}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={() => addChart('bar')} style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>{t('create.chartBar')}</button>
            <button onClick={() => addChart('line')} style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>{t('create.chartLine')}</button>
            <button onClick={addAscii} style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>{t('create.ascii')}</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {skills.elements.map(e => (
              <button key={e.kind} onClick={() => addComponent(e.snippet)} style={{ ...btn, padding: '4px 10px', fontSize: 11, borderColor: '#60a5fa', color: '#60a5fa', background: 'rgba(96,165,250,0.1)' }} title={e.snippet.slice(0, 60)}>{e.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>{t('create.props')}</div>
          {!sel && <div style={{ fontSize: 11, color: MUTED }}>{t('create.clickBlock')}</div>}
          {sel && (
            <>
              <div style={field}><span>{t('create.type')}</span><span style={{ color: EMERALD }}>{sel.kind === 'image' ? '图片' : '文本'}</span></div>
              {sel.kind === 'text' && (
                <>
                  <div style={field}><span>{t('create.fontSize')}</span>
                    <select value={sel.size || 14} onChange={e => patchSel({ size: Number(e.target.value) })} style={{ background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 11 }}>
                      {[12, 14, 16, 20, 24, 32].map(s => <option key={s} value={s}>{s}px</option>)}
                    </select>
                  </div>
                  <div style={field}><span>{t('create.color')}</span>
                    <input type="color" value={sel.color || '#e8edf2'} onChange={e => patchSel({ color: e.target.value })} style={{ width: 40, height: 22, border: 'none', background: 'none' }} />
                  </div>
                </>
              )}
              {sel.kind === 'image' && (
                <div style={field}><span>{t('create.height')}</span>
                  <input type="number" value={sel.size || 320} onChange={e => patchSel({ size: Number(e.target.value) })} style={{ width: 56, background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 11 }} />
                </div>
              )}
              {sel.kind === 'chart' && (
                <>
                  <div style={field}><span>{t('create.type')}</span>
                    <select value={parseChart(sel.content).type} onChange={e => { const t = e.target.value; patchSel({ content: `${t}\n${sel.content.split('\n').slice(1).join('\n')}` }) }} style={selStyle}>
                      <option value="bar">{t('create.chartBarOpt')}</option><option value="line">{t('create.chartLineOpt')}</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, margin: '4px 0' }}>{t('create.chartDataHint')}</div>
                  <textarea value={sel.content} onChange={e => patchSel({ content: e.target.value })} rows={6}
                    style={{ width: '100%', background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 11, padding: 6, resize: 'vertical' }} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Phase-3 sub windows (work-window type, state synced via JSON) ──

function SubShell({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${EDGE}`, WebkitAppRegion: 'drag' as any }}>
        <div data-ntd style={{ display: 'flex', gap: 7, WebkitAppRegion: 'no-drag' as any }}>
          <span onClick={() => window.deskAppAPI.createWinClose()} title={t('create.close')} style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer' }} />
          <span onClick={() => window.deskAppAPI.createWinMinimize()} title={t('create.minimize')} style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', cursor: 'pointer' }} />
        </div>
        <span style={{ fontSize: 13, color: MUTED }}>{title}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>{children}</div>
    </div>
  )
}

function useSubSource(): string {
  const [src, setSrc] = useState('')
  useEffect(() => { window.deskAppAPI.getCreatePayload().then((p: any) => p?.source && setSrc(p.source)) }, [])
  return src
}

function StyleSub(): React.JSX.Element {
  const source = useSubSource()
  const [tpls, setTpls] = useState<{ id: string; label: string }[]>([])
  const [templateId, setTemplateId] = useState('')
  const [color, setColor] = useState('#ff6a3d')
  const [font, setFont] = useState('')
  const [status, setStatus] = useState('')
  const COLORS = ['#ff6a3d', '#34d399', '#60a5fa', '#f472b6', '#a78bfa']
  const FONTS = ['', 'Noto Serif SC', 'JetBrains Mono']
  useEffect(() => {
    window.deskAppAPI.getCreateSkills().then((s: any) => setTpls(s?.templates || []))
    if (source) window.deskAppAPI.loadCreateState(source).then((st: any) => { if (st) { if (st.templateId) setTemplateId(st.templateId); if (st.themeColor) setColor(st.themeColor); if (st.themeFont !== undefined) setFont(st.themeFont) } })
  }, [source])
  const apply = () => {
    window.deskAppAPI.loadCreateState(source).then((st: any) => {
      window.deskAppAPI.saveCreateState({ dir: source, state: { ...(st || { title: '', blocks: [] }), templateId, themeColor: color, themeFont: font } })
      window.deskAppAPI.notifyCreateStateChanged()
      setStatus(t('create.applied'))
    })
  }
  return (
    <SubShell title={t('create.styleSel')}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>{t('create.template')}</div>
      {tpls.map(t => (
        <div key={t.id} onClick={() => setTemplateId(t.id)}
          style={{ padding: '10px 12px', marginBottom: 8, borderRadius: 10, cursor: 'pointer', border: `1px solid ${templateId === t.id ? EMERALD : EDGE}`, background: templateId === t.id ? 'rgba(52,211,153,0.08)' : PANEL, fontSize: 13 }}>
          {t.label}
        </div>
      ))}
      <div style={{ fontSize: 12, color: MUTED, margin: '14px 0 8px' }}>{t('create.themeColor')}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {COLORS.map(c => (
          <span key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '2px solid #fff' : `2px solid transparent` }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED, margin: '0 0 8px' }}>{t('create.font')}</div>
      <select value={font} onChange={e => setFont(e.target.value)} style={{ background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 12, padding: '6px 10px', width: '100%' }}>
        {FONTS.map(f => <option key={f} value={f}>{f || t('create.fontDefault')}</option>)}
      </select>
      <button onClick={apply} style={{ background: 'rgba(52,211,153,0.15)', border: `1px solid ${EMERALD}`, color: EMERALD, borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>应用</button>
      {status && <div style={{ fontSize: 12, color: EMERALD, marginTop: 10 }}>{status}</div>}
    </SubShell>
  )
}

function MaterialSub(): React.JSX.Element {
  const source = useSubSource()
  const [tree, setTree] = useState<TreeItem[]>([])
  const [status, setStatus] = useState('')
  const open = (it: TreeItem) => { if (it.isDir) window.deskAppAPI.scanCreateDir(it.path).then((x: any) => setTree(x || [])) }
  useEffect(() => { if (source) window.deskAppAPI.scanCreateDir(source).then((x: any) => setTree(x || [])) }, [source])
  const add = async (it: TreeItem) => {
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(it.name)
    const kind = isImg ? 'image' : /\.csv$/i.test(it.name) ? 'table' : /\.(md|txt)$/i.test(it.name) ? 'text' : ''
    if (!kind) { setStatus(t('create.onlyTypes')); return }
    let content = it.path
    if (kind !== 'image') content = (await window.deskAppAPI.readCreateFile(it.path)).slice(0, kind === 'table' ? 8000 : 2000)
    const st = await window.deskAppAPI.loadCreateState(source)
    const blocks = [...(st?.blocks || []), { id: 'b' + Date.now() + Math.random().toString(36).slice(2, 4), kind, content }]
    window.deskAppAPI.saveCreateState({ dir: source, state: { ...(st || { title: '', templateId: '' }), blocks } })
    window.deskAppAPI.notifyCreateStateChanged()
    setStatus(t('create.added', { name: it.name }))
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: INK }
  return (
    <SubShell title={t('create.assets')}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, wordBreak: 'break-all' }}>📂 {source}</div>
      {tree.map(it => (
        <div key={it.path} style={row} onClick={() => it.isDir ? open(it) : add(it)} title={it.path}>
          <span>{it.isDir ? '📁' : '📄'}</span>
          <span style={{ color: it.isDir ? EMERALD : INK }}>{it.name}</span>
        </div>
      ))}
      {tree.length === 0 && <div style={{ fontSize: 11, color: MUTED }}>{t('create.dirEmpty2')}</div>}
      {status && <div style={{ fontSize: 12, color: EMERALD, marginTop: 10 }}>{status}</div>}
    </SubShell>
  )
}

function ExportSub(): React.JSX.Element {
  const source = useSubSource()
  const [format, setFormat] = useState<'html' | 'pdf' | 'pptx'>('html')
  const [outDir, setOutDir] = useState(source)
  const [status, setStatus] = useState('')
  useEffect(() => { if (source) setOutDir(source) }, [source])
  const go = async () => {
    const st = await window.deskAppAPI.loadCreateState(source)
    const path = await window.deskAppAPI.exportCreate({ title: st?.title || t('create.work'), blocks: st?.blocks || [], format, dir: outDir, templateId: st?.templateId, themeColor: st?.themeColor, themeFont: st?.themeFont })
    setStatus(path ? t('create.exported', { path }) : t('create.exportFail'))
  }
  const selStyle: React.CSSProperties = { background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 12, padding: '6px 10px' }
  return (
    <SubShell title={t('create.exportCfg')}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>{t('create.format')}</div>
      <select value={format} onChange={e => setFormat(e.target.value as 'html' | 'pdf' | 'pptx')} style={selStyle}>
        <option value="html">HTML</option><option value="pdf">PDF</option><option value="pptx">PPTX</option>
      </select>
      <div style={{ fontSize: 12, color: MUTED, margin: '14px 0 8px' }}>{t('create.outDir2')}</div>
      <input value={outDir} onChange={e => setOutDir(e.target.value)} style={{ width: '100%', background: PANEL, border: `1px solid ${EDGE}`, color: INK, borderRadius: 6, fontSize: 12, padding: '6px 10px', outline: 'none' }} />
      <button onClick={go} style={{ background: 'rgba(52,211,153,0.15)', border: `1px solid ${EMERALD}`, color: EMERALD, borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>导出</button>
      {status && <div style={{ fontSize: 12, color: EMERALD, marginTop: 10, wordBreak: 'break-all' }}>{status}</div>}
    </SubShell>
  )
}
