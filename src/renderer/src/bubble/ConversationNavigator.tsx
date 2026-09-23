import { useState, useRef, useEffect, useCallback } from 'react'
import { t } from '../lib/i18n'

interface OutlineItem {
  id: string
  title: string
  messageId: string
}

const NAV_WIDTH = 260
const BTN_SIZE = 36

export function useConversationOutline(messages: { id: string; role: string; content: string }[]): OutlineItem[] {
  const items: OutlineItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const title = m.content.substring(0, 40) + (m.content.length > 40 ? '...' : '')
      items.push({ id: m.id, title, messageId: m.id })
    }
  }
  return items
}

export function ConversationNavigator({ items, exportSession }: { items: OutlineItem[]; exportSession: () => void }) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track visible section via IntersectionObserver
  useEffect(() => {
    if (items.length === 0) return
    const observers: IntersectionObserver[] = []
    for (const item of items) {
      const el = document.getElementById(`msg-${item.messageId}`)
      if (!el) continue
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveId(item.messageId) },
        { threshold: 0.5 }
      )
      obs.observe(el)
      observers.push(obs)
    }
    return () => observers.forEach(o => o.disconnect())
  }, [items])

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    enterTimer.current = setTimeout(() => setOpen(true), 150)
  }, [])

  const handleLeave = useCallback(() => {
    if (enterTimer.current) { clearTimeout(enterTimer.current); enterTimer.current = null }
    leaveTimer.current = setTimeout(() => setOpen(false), 300)
  }, [])

  const handleClick = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.transition = 'background 300ms ease'
      el.style.background = 'var(--accent-soft)'
      setTimeout(() => { el.style.background = '' }, 1500)
    }
  }, [])

  if (items.length === 0) return <></>

  return (
    <div
      style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        pointerEvents: open ? 'auto' : 'none', zIndex: 10,
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Trigger button — hamburger icon on right edge */}
      <div
        style={{
          position: 'absolute', right: 8, top: '50%',
          transform: 'translateY(-50%)',
          width: BTN_SIZE, height: BTN_SIZE,
          borderRadius: 10,
          background: open ? 'var(--solid)' : 'var(--bg-card)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, cursor: 'pointer',
          pointerEvents: 'auto',
          transition: 'background 150ms ease',
        }}
      >
        {[0, 1, 2].map(i => (
          <span key={i} style={{ width: 14, height: 1.5, background: 'var(--ink-muted)', borderRadius: 1 }} />
        ))}
      </div>

      {/* Slide-out panel */}
      <div
        style={{
          position: 'absolute',
          right: open ? 52 : -NAV_WIDTH, top: '50%',
          transform: 'translateY(-50%)',
          width: NAV_WIDTH, maxHeight: 360,
          background: 'var(--bg-panel)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px var(--bg-hover)',
          overflow: 'hidden',
          transition: 'right 250ms cubic-bezier(0.23, 1, 0.32, 1)',
          display: 'flex', flexDirection: 'column',
          pointerEvents: 'auto',
        }}
      >
        <div style={{
          padding: '12px 14px 8px',
          borderBottom: '1px solid var(--line)',
          fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{t('nav.outline')}</span>
          <button onClick={exportSession} title="导出当前会话"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}>
            ⬇ 导出
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => handleClick(item.messageId)}
              style={{
                padding: '8px 14px',
                fontSize: 11,
                color: activeId === item.messageId ? 'var(--ink)' : 'var(--ink-muted)',
                cursor: 'pointer',
                background: activeId === item.messageId ? 'var(--accent-soft)' : 'transparent',
                borderLeft: activeId === item.messageId ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 150ms ease',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
              onMouseEnter={e => {
                if (activeId !== item.messageId) e.currentTarget.style.background = 'var(--bg-card)'
              }}
              onMouseLeave={e => {
                if (activeId !== item.messageId) e.currentTarget.style.background = 'transparent'
              }}
            >
              {item.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
