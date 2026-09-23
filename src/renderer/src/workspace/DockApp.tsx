// ── DockApp: verbatim port of wenxibuddy CoverFlowDeck — 7-card fan, wheel switch ──
// Same layout & dynamics as the original: left-anchored one-directional fan
// (perspectiveOrigin 38%, x = active ? -56 : -18+diff*42, rotY decreasing),
// spring 300/28/0.72, wheel accumulate+lock, 4.5s autoplay, page dots, glow.
// Deck is always 7 cards: real windows → templates (定时搜索/汇总/盯盘) → slots.
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../lib/i18n'
import { motion } from 'framer-motion'
import type { WindowSpec, SpecStatus } from '../../../shared/gen-ui-types'
import WindowCard from './WindowCard'

const spring = { type: 'spring' as const, stiffness: 300, damping: 28, mass: 0.72 }

// Fixed card size (wenxibuddy uses % clamp — a compact dock needs fixed px).
const CARD_W = 200
const CARD_H = 340
// Compact fan: step 24 stacks cards tighter; left offset 96 keeps the active
// card + shadow unclipped — the whole deck compresses from the right.
const STEP = 24
const FAN_LEFT = 96

export default function DockApp() {
  const [specs, setSpecs] = useState<(WindowSpec & { status?: SpecStatus })[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [autoPlay, setAutoPlay] = useState(true)
  const [hovered, setHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelLock = useRef(false)
  const wheelAcc = useRef(0)
  // Drag-to-move the whole deck: press on any card, move >3px → drag the
  // window; below threshold it stays a click (select). Cleared after click.
  const dragRef = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)

  const load = useCallback(async () => {
    const list = await window.deskAppAPI?.genui?.listSpecs() ?? []
    const statuses = await window.deskAppAPI?.genui?.listStatuses() ?? []
    setStatusMap(Object.fromEntries(statuses.map((s: SpecStatus) => [s.specId, s])))
    setSpecs(list.map(s => ({ ...s, status: statuses.find((st: SpecStatus) => st.specId === s.id) })))
    window.deskAppAPI?.genui?.log?.(`[dock] mounted specs=${list.map((s: any) => `${s.id}:cron=${!!s.cron}`).join(',')}`)
    // PROBE: where the play button actually is vs where clicks land.
    setTimeout(() => {
      const btn = document.querySelector('[data-ntd][title*="运行"]')
      if (btn) { const r = btn.getBoundingClientRect(); window.deskAppAPI?.genui?.log?.(`[dock] btn-rect x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`) }
      else window.deskAppAPI?.genui?.log?.(`[dock] btn-rect NOT FOUND`)
    }, 800)
  }, [])

  useEffect(() => { load() }, [load])
  // Live status (run/stop/cron ticks) — without this the deck shows stale state
  const [statusMap, setStatusMap] = useState<Record<string, SpecStatus>>({})
  useEffect(() => {
    return window.deskAppAPI?.onStatusChanged?.((st: SpecStatus) => setStatusMap(prev => ({ ...prev, [st.specId]: st }))) ?? (() => {})
  }, [])
  useEffect(() => {
    const u1 = window.deskAppAPI?.onSpecChanged?.((s) => {
      setSpecs(prev => { const i = prev.findIndex(x => x.id === s.id); return i >= 0 ? prev.map(x => x.id === s.id ? { ...x, ...s } : x) : [...prev, s] })
    })
    const u2 = window.deskAppAPI?.onSpecRemoved?.((id) => setSpecs(prev => prev.filter(x => x.id !== id)))
    return () => { u1?.(); u2?.() }
  }, [])
  // Specs currently pulled out into card windows — their deck cards hide
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  useEffect(() => {
    window.deskAppAPI?.genui?.pulledOut?.().then((ids) => setHidden(new Set(ids))).catch(() => {})
    return window.deskAppAPI?.onDeckHide?.((ids) => setHidden(new Set(ids))) ?? (() => {})
  }, [])

  // Deck: every real window is a card — count grows as windows are added.
  const deck: (WindowSpec & { status?: SpecStatus })[] = specs.filter(s => !hidden.has(s.id))
  const items = deck

  // Newest window becomes the active card — creation/archiving is visible
  useEffect(() => { if (specs.length) setActiveIndex(specs.length - 1) }, [specs.length])

  const go = useCallback((dir: 1 | -1) => {
    setActiveIndex(p => (p + dir + items.length) % items.length)
  }, [items.length])

  // Autoplay: 4.5s until first hover (wenxibuddy)
  useEffect(() => {
    if (!autoPlay || hovered) return
    const id = window.setInterval(() => go(1), 4500)
    return () => window.clearInterval(id)
  }, [autoPlay, hovered, go])

  // Wheel → switch (wenxibuddy: accumulate deltaY, 28px threshold, 320ms lock).
  // Capture on window so it also fires over the top drag strip.
  useEffect(() => {
    const el = containerRef.current
    const onWheel = (e: WheelEvent) => {
      // Wheel over a scrollable list (card content) → native scroll, not card switching
      if ((e.target as HTMLElement).closest?.('[data-scroll]')) return
      e.preventDefault()
      e.stopPropagation()
      wheelAcc.current += e.deltaY
      if (wheelLock.current) return
      if (Math.abs(wheelAcc.current) < 28) return
      const dir: 1 | -1 = wheelAcc.current > 0 ? 1 : -1
      wheelAcc.current = 0
      wheelLock.current = true
      go(dir)
      window.setTimeout(() => { wheelLock.current = false }, 320)
    }
    const target = el ?? window
    target.addEventListener('wheel', onWheel, { passive: false, capture: true } as any)
    return () => target.removeEventListener('wheel', onWheel, { capture: true } as any)
  }, [go])

  const focusWorkspace = (id: string) => window.deskAppAPI?.genui?.focusSpec(id)

  // Pull a window card back out of the deck into a standalone card window for
  // re-editing (edit via bubble, run, re-archive by dragging it back in).
  const pullOut = (id: string) => window.deskAppAPI?.genui?.openCard(id)

  // Press anywhere → track; only start the cursor-follow drag after >3px
  // movement. Starting it on mousedown made EVERY click move the window with
  // the tiniest hand drift → clicks landed on the wrong (overlapping) card,
  // and a missed mouseup left the window following the cursor forever.
  const onDeckMouseDown = (e: React.MouseEvent) => {
    // Interactive elements (play/traffic lights/name input) never start a
    // drag — else a wiggly click triggers cursor-follow, the window moves
    // mid-press and the button's click never fires.
    if ((e.target as HTMLElement).closest('input,button,[data-ntd]')) return
    dragRef.current = { sx: 0, sy: 0, moved: false }
  }
  const onDeckMouseMove = (e: React.MouseEvent) => {
    // ponytail: the window itself is dragged natively (app-region drag on the
    // strip); deck mousemove only tracks click-vs-drag for the card click.
    const d = dragRef.current
    if (!d) return
    const dx = e.screenX - d.sx
    const dy = e.screenY - d.sy
    d.sx = e.screenX
    d.sy = e.screenY
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true
  }
  const onDeckMouseUp = () => {
    // Clear after click fires (click runs right after mouseup)
    setTimeout(() => { dragRef.current = null }, 0)
  }

  // Native macOS window drag on the strip (app-region) — the JS cursor-follow
  // (32Hz setPosition on a transparent window) backlogs the window server and
  // the dock drag degrades after the app runs a while. The deck cards are
  // no-drag so clicks/wheel/scroll keep working; the strip drags the window.
  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100vh', position: 'relative',
        overflow: 'hidden', userSelect: 'none', cursor: 'default',
        WebkitAppRegion: 'drag' as any,
      }}
      onMouseEnter={() => { setHovered(true); setAutoPlay(false) }}
      onMouseLeave={() => { setHovered(false); setAutoPlay(true) }}
      onMouseDown={onDeckMouseDown}
      onMouseMove={onDeckMouseMove}
      onMouseUp={onDeckMouseUp}
      onClickCapture={(e) => { const t = e.target as HTMLElement; window.deskAppAPI?.genui?.log?.('[dock] capture', t.tagName, t.hasAttribute?.('data-ntd'), (t.className || '').toString().slice(0, 40), Math.round(e.clientX), Math.round(e.clientY)) }}
      title={t('dock.wheel')}
    >
      {/* Dock traffic lights: minimize → macOS Dock, close, maximize → workspace (no-drag under the strip drag region) */}
      <div data-ntd style={{ position: 'absolute', top: 2, left: 10, zIndex: 60, display: 'flex', gap: 7, WebkitAppRegion: 'no-drag' as any }}>
        <span onClick={(e) => { e.stopPropagation(); window.deskAppAPI?.dockClose?.() }} title="关闭" style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.25)' }} />
        <span onClick={(e) => { e.stopPropagation(); window.deskAppAPI?.dockMinimize?.() }} title="最小化到 Dock" style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.25)' }} />
        <span onClick={(e) => { e.stopPropagation(); window.deskAppAPI?.dockMaximize?.() }} title="打开任务台" style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.25)' }} />
      </div>
      {/* 3D fan — wenxibuddy geometry verbatim (left-anchored, unsigned diff) */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        perspective: '1600px', perspectiveOrigin: '38% 50%',
      }}>
        {items.map((item, index) => {
          const diff = (index - activeIndex + items.length) % items.length
          const isActive = diff === 0
          // wenxibuddy fan geometry, tighter step for a compact dock
          const step = STEP
          const x = isActive ? -56 : -18 + diff * step
          const y = diff * 1.5
          const z = -diff * 58
          const rotY = isActive ? -8 : -28 - diff * 1.4
          const scale = isActive ? 1.08 : Math.max(0.76, 1 - diff * 0.045)
          const opacity = isActive ? 1 : Math.max(0.3, 0.94 - diff * 0.09)
          const zIndex = items.length - diff

          return (
            <motion.div
              key={item.id}
              onClick={() => {
                if (dragRef.current?.moved) return
                setActiveIndex(index)  // bring the card forward — run/stop ONLY via the ▶ button
              }}
              initial={false}
              animate={{ x, y, z, rotateY: rotY, scale, opacity }}
              transition={spring}
              style={{
                position: 'absolute', left: FAN_LEFT, top: '50%', marginTop: -CARD_H / 2,  // active (x=-56, scale 1.08) keeps left margin visible
                width: CARD_W, height: CARD_H,
                zIndex,
                transformStyle: 'preserve-3d',
                willChange: 'transform', cursor: 'pointer',
                WebkitAppRegion: 'no-drag' as any,  // deck stays interactive under the native strip drag
              }}
              title={item.title}
            >
              <WindowCard
                spec={item} status={statusMap[item.id] || item.status} active={isActive}
                canRun={!!item.cron}
                onRun={() => {
                  window.deskAppAPI?.genui?.log?.(`[dock] onRun ${item.id} cron=${!!item.cron} status=${(statusMap[item.id] || item.status)?.status}`)
                  setActiveIndex(index)  // bring the card forward so its state is visible
                  if (!item.cron) { pullOut(item.id); return }  // no schedule → open it to configure
                  if ((statusMap[item.id] || item.status)?.status === 'running') window.deskAppAPI?.genui?.stopSpec(item.id)
                  else window.deskAppAPI?.genui?.runSpec(item.id)
                }}
                onMaximize={() => pullOut(item.id)}
                onClose={() => window.deskAppAPI?.genui?.removeSpec(item.id)}
              />
            </motion.div>
          )
        })}
      </div>

      {/* Page dots (wenxibuddy: top-right) */}
      <div style={{ position: 'absolute', top: 20, right: 8, zIndex: 50, display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
        {items.map((d, i) => (
          <span key={`d-${i}`} style={{
            borderRadius: 99,
            background: i === activeIndex ? 'rgba(110,231,183,0.9)' : 'rgba(255,255,255,0.25)',
            transition: 'all 200ms',
            width: i === activeIndex ? 16 : 6, height: 6,
          }} />
        ))}
      </div>

      {/* Hover hint (wenxibuddy) */}
      {hovered && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 50, fontSize: 10, color: 'rgba(255,255,255,0.45)', padding: '4px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'none' }}>
          {t('dock.wheelCount', { cur: activeIndex + 1, total: items.length })}
        </div>
      )}
    </div>
  )
}
