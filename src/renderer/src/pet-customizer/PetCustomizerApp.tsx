import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import CustomPet from '../pet/CustomPet'
import {
  autoMatte, pickTolerance, paintBrush, posterize, computeBBox,
  type MatteResult,
} from './matting'
import { buildSpritesheet, getSubjectFit } from './spritesheet'
import { segmenter } from './segnet'

/**
 * PetCustomizerApp — photo → custom desktop pet.
 *
 * Flow: upload → auto subject extraction (border flood-fill + largest
 * component) → optional AI label (vision LLM via main) → manual refine
 * (tolerance slider, erase/restore brush) → style (original/pixel/cartoon)
 * → live spritesheet preview → save (PNG + procedural spritesheet).
 * Saving adds to the pet library and activates it (main broadcasts).
 */

type Style = 'original' | 'pixel' | 'cartoon'
type BrushMode = 'erase' | 'restore'
/** How the current mask was produced: local U2-Net vs flood-fill heuristic */
type SegMode = 'ai' | 'flood'

interface Source {
  rgba: Uint8ClampedArray
  w: number
  h: number
}

const MAX_EDGE = 1024
const EXPORT_SIZE = 512
const UNDO_DEPTH = 20

function STYLE_META(): Record<Style, { name: string; desc: string }> {
  return {
    original: { name: t('pc.orig'), desc: t('pc.origDesc') },
    pixel: { name: t('pc.pixel'), desc: t('pc.pixelDesc') },
    cartoon: { name: t('pc.cartoon'), desc: t('pc.cartoonDesc') },
  }
}

/** Downscale source into MAX_EDGE bounds and read its pixels. */
function loadSource(img: HTMLImageElement): Source {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h }
}

export default function PetCustomizerApp(): React.JSX.Element {
  const [source, setSource] = useState<Source | null>(null)
  const [mask, setMask] = useState<Uint8Array | null>(null)
  const [stats, setStats] = useState<MatteResult | null>(null)
  const [segMode, setSegMode] = useState<SegMode>('flood')
  const [tolerance, setTolerance] = useState(26)
  const [autoBusy, setAutoBusy] = useState(false)
  const [brushMode, setBrushMode] = useState<BrushMode>('erase')
  const [brushSize, setBrushSize] = useState(24)
  const [style, setStyle] = useState<Style>('original')
  const [name, setName] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classifyHint, setClassifyHint] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const historyRef = useRef<Uint8Array[]>([])
  const strokeActiveRef = useRef(false)
  const recomputeTimer = useRef(0)

  // ── upload ──
  const acceptFile = useCallback((file: File) => {
    setError(null)
    setLabel(null)
    if (!file.type.startsWith('image/')) { setError(t('pc.err.type')); return }
    if (file.size > 8 * 1024 * 1024) { setError(t('pc.err.size')); return }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const src = loadSource(img)
        setSource(src)
        setMask(null)
        setStats(null)
        setName(file.name.replace(/\.[^.]+$/, ''))
        historyRef.current = []
        runAuto(src)
      }
      img.onerror = () => setError(t('pc.err.read'))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }, [])

  // ── auto subject extraction ──
  // L1: local U2-Net segmentation (survives complex backgrounds); L2:
  // flood-fill heuristic when the model is unavailable or returns nothing.
  const runAuto = useCallback(async (src: Source, tol?: number): Promise<void> => {
    setAutoBusy(true)
    // let the busy spinner paint before the sync heavy work
    await new Promise((r) => setTimeout(r, 30))

    // L1: U2-Net
    if (await segmenter.load()) {
      const m = await segmenter.segment(src.rgba, src.w, src.h)
      if (m && m.includes(255)) {
        const bbox = computeBBox(m, src.w, src.h)
        let count = 0
        for (let i = 0; i < m.length; i++) if (m[i] === 255) count++
        setMask(m)
        setStats({ mask: m, bbox, fgRatio: count / m.length })
        setSegMode('ai')
        historyRef.current = []
        setAutoBusy(false)
        return
      }
    }

    // L2: flood-fill heuristic
    const t = tol ?? pickTolerance(src.rgba, src.w, src.h)
    const res = autoMatte(src.rgba, src.w, src.h, t)
    setTolerance(t)
    setMask(res.mask)
    setStats(res)
    setSegMode('flood')
    historyRef.current = []
    setAutoBusy(false)
  }, [])

  // tolerance slider → debounced recompute (flood-fill mode only)
  useEffect(() => {
    if (!source || segMode !== 'flood') return
    window.clearTimeout(recomputeTimer.current)
    recomputeTimer.current = window.setTimeout(() => {
      const res = autoMatte(source.rgba, source.w, source.h, tolerance)
      setMask(res.mask)
      setStats(res)
    }, 150)
    return () => window.clearTimeout(recomputeTimer.current)
  }, [tolerance, source, segMode])

  // ── brush ──
  const pushUndo = useCallback((m: Uint8Array) => {
    const hist = historyRef.current
    hist.push(m.slice())
    if (hist.length > UNDO_DEPTH) hist.shift()
  }, [])

  const undo = useCallback(() => {
    const prev = historyRef.current.pop()
    if (prev) setMask(prev)
  }, [])

  const brushAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas || !source || !mask) return
    const rect = canvas.getBoundingClientRect()
    const sx = source.w / rect.width
    const sy = source.h / rect.height
    const x = (clientX - rect.left) * sx
    const y = (clientY - rect.top) * sy
    const r = brushSize * Math.max(sx, sy)
    if (!strokeActiveRef.current) pushUndo(mask)
    strokeActiveRef.current = true
    const next = mask.slice()
    paintBrush(next, source.w, source.h, x, y, r, brushMode)
    setMask(next)
  }, [source, mask, brushSize, brushMode, pushUndo])

  const endStroke = useCallback(() => { strokeActiveRef.current = false }, [])

  // ── render preview canvas (checkerboard + extracted subject) ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source || !mask) return
    const ctx = canvas.getContext('2d')!
    canvas.width = source.w
    canvas.height = source.h
    // checkerboard backdrop
    const cell = 12
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, source.w, source.h)
    ctx.fillStyle = '#E5E7EB'
    for (let y = 0; y < source.h; y += cell) {
      for (let x = 0; x < source.w; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) ctx.fillRect(x, y, cell, cell)
      }
    }
    const data = ctx.createImageData(source.w, source.h)
    data.data.set(source.rgba)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 0) data.data[i * 4 + 3] = 0
    }
    ctx.putImageData(data, 0, 0)
  }, [source, mask])

  /**
   * Subject canvas: bbox-cropped transparent subject (mask applied),
   * optional posterize style. Reused by export + spritesheet builder.
   */
  const buildSubject = useCallback((src: Source, m: Uint8Array, st: Style): HTMLCanvasElement | null => {
    const bbox = computeBBox(m, src.w, src.h)
    if (!bbox) return null
    const c = document.createElement('canvas')
    c.width = bbox.w
    c.height = bbox.h
    const ctx = c.getContext('2d')!
    const data = ctx.createImageData(bbox.w, bbox.h)
    for (let y = 0; y < bbox.h; y++) {
      for (let x = 0; x < bbox.w; x++) {
        const si = ((y + bbox.y) * src.w + (x + bbox.x)) * 4
        const di = (y * bbox.w + x) * 4
        data.data[di] = src.rgba[si]
        data.data[di + 1] = src.rgba[si + 1]
        data.data[di + 2] = src.rgba[si + 2]
        data.data[di + 3] = m[(y + bbox.y) * src.w + (x + bbox.x)] === 255 ? src.rgba[si + 3] : 0
      }
    }
    if (st === 'cartoon') posterize(data.data, 4, 0.35)
    ctx.putImageData(data, 0, 0)
    return c
  }, [])

  const subject = useMemo<HTMLCanvasElement | null>(
    () => (source && mask ? buildSubject(source, mask, style) : null),
    [source, mask, style, buildSubject],
  )

  /** 512² export PNG: subject auto-centered at 80%, optional pixelation. */
  const buildExport = useCallback((subj: HTMLCanvasElement): string => {
    const c = document.createElement('canvas')
    c.width = EXPORT_SIZE
    c.height = EXPORT_SIZE
    const ctx = c.getContext('2d')!
    const fit = getSubjectFit(subj.width, subj.height, EXPORT_SIZE, 0.8)
    ctx.drawImage(subj, fit.x, fit.y, fit.w, fit.h)
    if (style === 'pixel') {
      const grid = Math.max(2, Math.round(EXPORT_SIZE / 14))
      const small = document.createElement('canvas')
      small.width = grid
      small.height = grid
      const sctx = small.getContext('2d')!
      sctx.imageSmoothingEnabled = false
      sctx.drawImage(c, 0, 0, grid, grid)
      ctx.clearRect(0, 0, EXPORT_SIZE, EXPORT_SIZE)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, EXPORT_SIZE, EXPORT_SIZE)
    }
    return c.toDataURL('image/png')
  }, [style])

  // live animation preview: the actual spritesheet the pet will play
  const previewSheet = useMemo(() => {
    if (!subject) return null
    return buildSpritesheet(subject).toDataURL('image/png')
  }, [subject])

  // ── AI subject label (vision LLM, optional) ──
  const runClassify = useCallback(async () => {
    if (!subject) return
    setClassifying(true)
    setError(null)
    try {
      // name hint drives the no-vision fallback layers (text LLM / filename keywords)
      const res = await window.deskAppAPI.classifyCustomPet(buildExport(subject), name)
      setLabel(res)
      setClassifyHint(res === null)
      if (res) {
        const clean = res.replace(/^（按文件名推测）|^\(guessed from filename\)/i, '').trim()
        setName((n) => (n && n !== t('pc.defaultName') ? n : clean))
      }
    } catch {
      setLabel(null)
      setClassifyHint(true)
    }
    setClassifying(false)
  }, [subject, buildExport, name])

  // ── save ──
  const save = useCallback(async () => {
    if (!source || !mask || !subject) return
    const pngUrl = buildExport(subject)
    const sheetUrl = previewSheet
    if (!pngUrl || !sheetUrl) { setError(t('pc.err.noSubject')); return }
    setSaving(true)
    setError(null)
    try {
      await window.deskAppAPI.saveCustomPet(pngUrl, sheetUrl, name)
      window.close()
    } catch (e) {
      setError(t('pc.err.save', { msg: (e as Error).message || String(e) }))
      setSaving(false)
    }
  }, [source, mask, subject, style, name, buildExport, previewSheet])

  // ── drag & drop ──
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => { e.preventDefault() }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (file) acceptFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [acceptFile])

  // keyboard: Ctrl+Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
    border: active ? 'none' : '1px solid var(--solid)',
    borderRadius: '8px', padding: '8px 10px', color: 'var(--ink)', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' as const,
  })

  return (
    <div style={{ padding: '20px 24px', height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>{t('pc.title')}</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', margin: '4px 0 10px' }}>
        {t('pc.desc')}
      </p>
      {error && (
        <p style={{ fontSize: '12px', color: '#EF4444', margin: '0 0 10px', padding: '8px 12px', background: 'var(--bg-elev)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.4)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
        {/* ── left: canvas / upload zone ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {!source ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1, border: '2px dashed var(--solid)', borderRadius: '12px',
                background: 'var(--bg-elev)', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
                color: 'var(--ink-muted)', fontSize: '14px',
              }}
            >
              <span style={{ fontSize: '36px' }}>🖼️</span>
              <span>{t('pc.drop')}</span>
              <span style={{ fontSize: '11px' }}>{t('pc.dropHint')}</span>
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={btnStyle(brushMode === 'erase')} onClick={() => setBrushMode('erase')}>{t('pc.erase')}</button>
                <button style={btnStyle(brushMode === 'restore')} onClick={() => setBrushMode('restore')}>{t('pc.restore')}</button>
                <input
                  type="range" min="6" max="64" value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ width: 110, accentColor: 'var(--accent)' }}
                  title={t('pc.brushSize')}
                />
                <button style={btnStyle(false)} onClick={undo} disabled={historyRef.current.length === 0}>{t('pc.undo')}</button>
                <button style={btnStyle(false)} onClick={() => fileInputRef.current?.click()}>{t('pc.swap')}</button>
              </div>
              <div style={{
                flex: 1, minHeight: 0, overflow: 'auto', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-elev)', border: '1px solid var(--bg-hover)', borderRadius: '12px',
              }}>
                <canvas
                  ref={canvasRef}
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); brushAt(e.clientX, e.clientY) }}
                  onPointerMove={(e) => { if (strokeActiveRef.current) brushAt(e.clientX, e.clientY) }}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                  style={{ maxWidth: '100%', maxHeight: '100%', cursor: 'crosshair', touchAction: 'none' }}
                />
              </div>
            </>
          )}
        </div>

        {/* ── right: controls ── */}
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          {source && (
            <>
              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>{t('pc.subjectLabel')}</label>
                  <button style={btnStyle(false)} onClick={() => runAuto(source)} disabled={autoBusy}>
                    {autoBusy ? t('pc.recognizing') : t('pc.autoRecognize')}
                  </button>
                </div>
                <label style={{ fontSize: '11px', color: 'var(--ink-muted)', display: 'block', marginBottom: 2 }}>
                  {t('pc.tolerance', { n: tolerance })}
                </label>
                <input
                  type="range" min="4" max="80" value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  disabled={segMode === 'ai'}
                  style={{ width: '100%', accentColor: 'var(--accent)', opacity: segMode === 'ai' ? 0.4 : 1 }}
                />
                {stats?.bbox && (
                  <p style={{ fontSize: '11px', color: 'var(--ink-faint)', margin: '8px 0 0' }}>
                    {t('pc.segMode', { mode: segMode === 'ai' ? t('pc.segAi') : t('pc.segAuto'), w: stats.bbox.w, h: stats.bbox.h })}px · 占比 {(stats.fgRatio * 100).toFixed(0)}%
                  </p>
                )}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px' }}>
                  <button style={btnStyle(false)} onClick={runClassify} disabled={classifying || !subject}>
                    {classifying ? t('pc.recognizing') : t('pc.aiRecognize')}
                  </button>
                  {label && (
                    <span
                      onClick={() => setName(label)}
                      title={t('pc.nameHint')}
                      style={{
                        flex: 1, fontSize: '12px', padding: '6px 8px', borderRadius: '6px',
                        background: 'var(--line)', border: '1px solid var(--solid)', color: 'var(--ink)',
                        cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
                {label === null && classifyHint && !classifying && (
                  <p style={{ fontSize: '10px', color: 'var(--ink-faint)', margin: '6px 0 0' }}>
                    {t('pc.noGuess')}
                  </p>
                )}
              </div>

              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>{t('pc.style')}</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(Object.keys(STYLE_META) as Style[]).map((s) => (
                    <button key={s} style={{ ...btnStyle(style === s), flex: 1 }} onClick={() => setStyle(s)}>
                      <div>{STYLE_META()[s].name}</div>
                      <div style={{ fontSize: '9px', fontWeight: 400, opacity: 0.7, marginTop: 2 }}>{STYLE_META()[s].desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('pc.preview')}</label>
                <div style={{ width: 150, height: 150, margin: '0 auto', position: 'relative' }}>
                  {previewSheet ? (
                    <CustomPet sheetUrl={previewSheet} pose="idle" mood="idle" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>{t('pc.pending')}</div>
                  )}
                </div>
              </div>

              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('pc.petName')}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder={t('pc.namePh')}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                    background: 'var(--line)', border: '1px solid var(--solid)', borderRadius: '8px',
                    color: 'var(--ink)', fontSize: '13px', fontFamily: 'inherit',
                  }}
                />
              </div>

              <button
                onClick={save}
                disabled={saving || !previewSheet}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                  border: 'none', borderRadius: '10px', padding: '12px',
                  color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? t('pc.saving') : t('pc.saveToLib')}
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); e.target.value = '' }}
      />
    </div>
  )
}
