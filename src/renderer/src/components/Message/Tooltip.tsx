import React, { useEffect, useState, useRef, useCallback } from 'react'

/**
 * Lightweight tooltip positioned above its trigger element.
 * Renders as a portal-free overlay with CSS scale+opacity entrance animation.
 */
export interface TooltipProps {
  /** Ref to the anchor element the tooltip is positioned relative to */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Tooltip text */
  children: React.ReactNode
  /** When true, show the tooltip */
  visible: boolean
  /** Delay in ms before the tooltip appears (default: 500) */
  delay?: number
}

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%) scale(0.95)',
  opacity: 0,
  padding: '4px 8px',
  borderRadius: '6px',
  background: '#1f2937',
  color: '#f9fafb',
  fontSize: '11px',
  lineHeight: '1.4',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 1000,
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  transition: 'opacity 120ms ease, transform 120ms ease',
}

export function Tooltip({ anchorRef, children, visible, delay = 500 }: TooltipProps): React.JSX.Element | null {
  const [show, setShow] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (visible) {
      timerRef.current = setTimeout(() => setShow(true), delay)
    } else {
      clearTimer()
      setShow(false)
    }
    return clearTimer
  }, [visible, delay, clearTimer])

  // Force immediate hide on unmount
  useEffect(() => {
    return () => {
      clearTimer()
      setShow(false)
    }
  }, [clearTimer])

  if (!show && !visible) return null

  const style: React.CSSProperties = {
    ...TOOLTIP_STYLE,
    opacity: show ? 1 : 0,
    transform: show ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(0.95)',
  }

  return <div style={style}>{children}</div>
}
