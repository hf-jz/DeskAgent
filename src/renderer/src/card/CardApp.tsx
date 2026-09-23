// ── CardApp: standalone draggable card window — define in bubble, run, drag to dock ──
// Shows the newest window spec as a frosted card. The whole card is a drag
// region (frameless window); the run/close buttons are no-drag.
import React, { useEffect, useState, useCallback, useRef } from 'react'
import type { WindowSpec, SpecStatus } from '../../../shared/gen-ui-types'
import WindowCard from '../workspace/WindowCard'
import ContentStudio from '../workspace/components/ContentStudio'
import { CONTENT_KINDS } from '../../../shared/gen-ui-types'

export default function CardApp() {
  const [specs, setSpecs] = useState<WindowSpec[]>([])
  const [statuses, setStatuses] = useState<Record<string, SpecStatus>>({})
  // Bound spec: passed at window creation, or claimed later via card-bind push
  const [boundId, setBoundId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('spec'))

  const load = useCallback(async () => {
    const list = await window.deskAppAPI?.genui?.listSpecs() ?? []
    setSpecs(list)
    const st = await window.deskAppAPI?.genui?.listStatuses() ?? []
    setStatuses(Object.fromEntries(st.map((s: SpecStatus) => [s.specId, s])))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const u1 = window.deskAppAPI?.onSpecChanged?.((s) => {
      setSpecs(prev => { const i = prev.findIndex(x => x.id === s.id); return i >= 0 ? prev.map(x => x.id === s.id ? s : x) : [...prev, s] })
    })
    const u2 = window.deskAppAPI?.onSpecRemoved?.((id) => setSpecs(prev => prev.filter(x => x.id !== id)))
    const u3 = window.deskAppAPI?.onStatusChanged?.((st) => setStatuses(prev => ({ ...prev, [st.specId]: st })))
    const u4 = window.deskAppAPI?.onCardBind?.((id) => setBoundId(id))
    return () => { u1?.(); u2?.(); u3?.(); u4?.() }
  }, [])

  // This card's spec — draft state until a spec is bound to it
  const spec = boundId ? specs.find(s => s.id === boundId) : undefined
  const status = spec ? statuses[spec.id] : undefined
  const hasList = Array.isArray(spec?.props?.history) && spec.props.history.length > 0
  const isContent = !!spec && CONTENT_KINDS.has(spec.kind)
  // 办公创作卡: 设计界面需要更大窗口; 普通卡按内容列表伸缩
  useEffect(() => {
    if (isContent) window.deskAppAPI?.cardResize?.(460, 640)
    else window.deskAppAPI?.cardResize?.(hasList ? 420 : 220, hasList ? 600 : 264)
  }, [isContent, hasList])
  // JS cursor-follow drag (dock-style): NO app-region drag region → the name
  // input keeps IME working, and the window stays draggable regardless of
  // input focus (a drag region never blurs a focused input).
  const dragRef = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)
  const onRootMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input,button,[data-ntd]')) return  // interactive
    // Window edges → native resize (frameless resizable window); don't steal them for drag.
    const r = e.currentTarget.getBoundingClientRect()
    const edge = e.clientX < r.left + 8 || e.clientX > r.right - 8 || e.clientY < r.top + 8 || e.clientY > r.bottom - 8
    if (edge) return
    dragRef.current = { sx: e.screenX, sy: e.screenY, moved: false }
  }
  const onRootMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.screenX - d.sx
    const dy = e.screenY - d.sy
    d.sx = e.screenX
    d.sy = e.screenY
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      d.moved = true
      window.deskAppAPI?.dragWindowStart?.()
    }
  }
  const onRootMouseUp = () => {
    window.deskAppAPI?.dragWindowEnd?.()
    setTimeout(() => { dragRef.current = null }, 0)
  }
  // ponytail: only the studio view (maximized canvas) keeps the JS polling
  // drag — the card view drags via the native -webkit-app-region (WindowCard),
  // which is system-driven and never janks on repeat drags.
  const rootDragProps = isContent
    ? { onMouseDown: onRootMouseDown, onMouseMove: onRootMouseMove, onMouseUp: onRootMouseUp }
    : {}

  return (
    <div
      {...rootDragProps}
      style={{
        width: '100vw', height: '100vh', position: 'relative',
        userSelect: 'none', cursor: 'default',
      }}
    >
      <div style={{ width: '100%', height: '100%' }}>
        {isContent && spec ? (
          <ContentStudio spec={spec} status={status} />
        ) : (
          <WindowCard
            spec={spec}
            status={status}
            active
            empty={!spec}
            dragSurface
            canRun={!!spec?.cron}
            onRun={spec?.cron ? () => {
              if (status?.status === 'running') window.deskAppAPI?.genui?.stopSpec(spec.id)
              else window.deskAppAPI?.genui?.runSpec(spec.id)
            } : undefined}
            onMinimize={() => window.deskAppAPI?.cardMinimize?.()}
            onClose={() => window.deskAppAPI?.cardCloseAndStop?.()}
            onNameDraft={(title) => window.deskAppAPI?.genui?.nameDraft?.(title)}
          />
        )}
      </div>
    </div>
  )
}
