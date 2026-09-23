import React, { useState, useRef, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip } from './Tooltip'

/**
 * A single action button in the message action bar.
 * 32×32px, border-radius 8px, icon 16px, strokeWidth 1.8,
 * default colour var(--ink-muted), hover colour var(--bg-page), hover background var(--ink).
 */
export interface ActionButtonProps {
  /** Lucide icon component */
  icon: LucideIcon
  /** Tooltip label shown above the button on hover */
  label: string
  /** Click handler */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Override the default colour (default: var(--ink-muted)) */
  color?: string
  /** Override the active/hover colour (default: var(--bg-page)) */
  activeColor?: string
  /** Override hover background (default: var(--ink)) */
  hoverBg?: string
  /** When true, show the icon in active/pressed state */
  active?: boolean
  /** Tooltip delay in ms (default: 500) */
  tooltipDelay?: number
  /** Additional className (for CSS class-based hover triggers) */
  className?: string
}

const BTN_BASE: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  position: 'relative',
  flexShrink: 0,
  transition: 'background 150ms ease, color 150ms ease',
}

export function ActionButton({
  icon: Icon,
  label,
  onClick,
  color = 'var(--ink-muted)',
  activeColor = 'var(--bg-page)',
  hoverBg = 'var(--ink)',
  active = false,
  tooltipDelay = 500,
  className,
}: ActionButtonProps): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleMouseEnter = useCallback(() => setHover(true), [])
  const handleMouseLeave = useCallback(() => setHover(false), [])

  const isActive = active || hover
  const currentColor = isActive ? activeColor : color
  const currentBg = hover ? hoverBg : 'transparent'

  return (
    <button
      ref={btnRef}
      className={className}
      style={{
        ...BTN_BASE,
        color: currentColor,
        background: currentBg,
      }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label={label}
    >
      <Icon size={16} strokeWidth={1.8} />
      <Tooltip anchorRef={btnRef} visible={hover} delay={tooltipDelay}>
        {label}
      </Tooltip>
    </button>
  )
}
