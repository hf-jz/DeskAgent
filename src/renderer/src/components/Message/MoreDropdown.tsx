import React, { useState, useRef, useEffect } from 'react'

export interface MoreOption {
  label: string
  onClick: () => void
  danger?: boolean
}

export interface MoreDropdownProps {
  options: MoreOption[]
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const DROPDOWN: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%) translateY(0)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--bg-hover)',
  borderRadius: '8px',
  padding: '4px',
  minWidth: '160px',
  zIndex: 1000,
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
}

const OPTION: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '7px 12px',
  background: 'transparent',
  border: 'none',
  borderRadius: '6px',
  fontSize: '12px',
  cursor: 'pointer',
  textAlign: 'left' as const,
  fontFamily: 'inherit',
  color: 'var(--ink-secondary)',
}

export function MoreDropdown({ options, onClose, anchorRef }: MoreDropdownProps): React.JSX.Element | null {
  const [animating, setAnimating] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Enter animation on mount
  useEffect(() => {
    timerRef.current = setTimeout(() => setAnimating(true), 16)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    // Delay binding to avoid catching the triggering click
    const t = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose, anchorRef])

  const style: React.CSSProperties = {
    ...DROPDOWN,
    opacity: animating ? 1 : 0,
    transform: animating ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(-4px)',
    transition: 'opacity 150ms ease, transform 150ms ease',
  }

  return (
    <div ref={dropdownRef} style={style}>
      {options.map((opt, i) => (
        <button
          key={i}
          style={{
            ...OPTION,
            color: opt.danger ? '#f87171' : 'var(--ink-secondary)',
          }}
          onClick={() => {
            onClose()
            opt.onClick()
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = opt.danger ? 'var(--danger-soft)' : 'var(--line)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
