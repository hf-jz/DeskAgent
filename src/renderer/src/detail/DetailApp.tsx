// ── DetailApp: standalone detail popup (markdown body) — wenxibuddy LiquidModal 规范 ──
import React, { useEffect, useState, useRef } from 'react'
import { t } from '../lib/i18n'
import { motion } from 'framer-motion'
import { BookOpen, X, Star, Share2 } from 'lucide-react'
import { MarkdownContent } from '../bubble/ReasoningTimeline'

export default function DetailApp() {
  const [data, setData] = useState<{ title: string; content: string } | null>(null)
  const [starred, setStarred] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.deskAppAPI?.detailGet?.().then((d: any) => setData(d)).catch(() => {})
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // JS cursor-follow drag; window edges → native resize.
  // ponytail: the header app-region drag froze on the SECOND drag (known
  // macOS/Electron quirk on frameless alwaysOnTop resizable windows) — back
  // to the JS polling, with the escalation fixed in the main (interval stops
  // when the cursor leaves the window, so a missed mouseup can't pile up).
  const dragRef = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)
  const onRootMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input,button,[data-ntd]')) return
    const r = e.currentTarget.getBoundingClientRect()
    const edge = e.clientX < r.left + 8 || e.clientX > r.right - 8 || e.clientY < r.top + 8 || e.clientY > r.bottom - 8
    if (edge) return
    dragRef.current = { sx: e.screenX, sy: e.screenY, moved: false }
  }
  const onRootMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.screenX - d.sx, dy = e.screenY - d.sy
    d.sx = e.screenX; d.sy = e.screenY
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      d.moved = true
      window.deskAppAPI?.dragWindowStart?.()
    }
  }
  const onRootMouseUp = () => { window.deskAppAPI?.dragWindowEnd?.(); setTimeout(() => { dragRef.current = null }, 0) }

  return (
    <div onMouseDown={onRootMouseDown} onMouseMove={onRootMouseMove} onMouseUp={onRootMouseUp} style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}>
      <div
        style={{
          width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
          background: 'rgb(21,26,34)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        {/* top emerald hairline + glow */}
        <div style={{ position: 'absolute', top: 0, left: 40, right: 40, height: 1, background: 'linear-gradient(90deg,transparent,rgba(52,211,153,0.7),transparent)' }} />
        <div style={{ position: 'absolute', top: -60, right: 0, width: 160, height: 160, borderRadius: '50%', background: 'rgba(52,211,153,0.10)', filter: 'blur(48px)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
          {/* header: icon well + title/subtitle + close — draggable (no data-ntd) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, cursor: 'move' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 14, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen style={{ width: 18, height: 18, color: '#6ee7b7' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: -0.2, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.title || '…'}</h3>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{t('detail.summaryReport')} · Markdown</div>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.08, rotate: 90 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => window.close()}
              data-ntd
              style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X style={{ width: 15, height: 15 }} />
            </motion.button>
          </div>

          {/* body — selectable, NOT a drag surface (copy-anywhere wins over body-drag) */}
          <div data-ntd style={{ flex: 1, minHeight: 0, overflowY: 'auto', userSelect: 'text' }}>
            {data ? <MarkdownContent text={data.content} /> : <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>加载中…</div>}
          </div>

          {/* footer buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button data-ntd onClick={() => window.close()} style={{ height: 36, padding: '0 14px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer' }}>关闭</button>
            <button data-ntd onClick={() => setStarred(s => !s)} style={{ height: 36, padding: '0 14px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: starred ? '#fcd34d' : 'rgba(255,255,255,0.7)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Star style={{ width: 13, height: 13, fill: starred ? '#fcd34d' : 'none' }} />{starred ? t('detail.unstar') : t('detail.star')}
            </button>
            <button
              data-ntd
              onClick={() => {
                if (data) { window.deskAppAPI?.writeClipboard?.(`# ${data.title}\n\n${data.content}`); setCopied(true); setTimeout(() => setCopied(false), 1500) }
              }}
              style={{ height: 36, padding: '0 16px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg,#34d399,#10b981)', color: '#06281c', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Share2 style={{ width: 13, height: 13 }} />{copied ? t('detail.copied') : t('detail.share')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
