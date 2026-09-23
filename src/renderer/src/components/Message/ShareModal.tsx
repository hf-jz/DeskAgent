import React, { useState, useEffect, useRef } from 'react'

export interface ShareModalProps {
  open: boolean
  onClose: () => void
  onCopyLink?: () => void
  onGenerateUrl?: () => void
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
}

const MODAL_BASE: React.CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--bg-hover)',
  borderRadius: '14px',
  padding: '24px',
  minWidth: '280px',
  maxWidth: '360px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  color: '#e5e5e5',
}

const TITLE: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  marginBottom: '16px',
  color: 'var(--ink)',
}

const BTN: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-card)',
  border: '1px solid var(--bg-hover)',
  borderRadius: '8px',
  color: 'var(--ink-secondary)',
  fontSize: '13px',
  cursor: 'pointer',
  textAlign: 'left' as const,
  fontFamily: 'inherit',
  marginBottom: '8px',
  transition: 'background 150ms ease, border-color 150ms ease',
}

const CANCEL: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  borderRadius: '8px',
  color: 'var(--ink-muted)',
  fontSize: '13px',
  cursor: 'pointer',
  textAlign: 'center' as const,
  fontFamily: 'inherit',
  marginTop: '4px',
  transition: 'color 150ms ease',
}

export function ShareModal({ open, onClose, onCopyLink, onGenerateUrl }: ShareModalProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [animating, setAnimating] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setVisible(true)
      // Trigger enter animation on next frame
      timerRef.current = setTimeout(() => setAnimating(true), 16)
    } else {
      setAnimating(false)
      timerRef.current = setTimeout(() => setVisible(false), 150)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [open])

  if (!visible) return null

  const modalStyle: React.CSSProperties = {
    ...MODAL_BASE,
    opacity: animating ? 1 : 0,
    transform: animating ? 'translateY(0)' : 'translateY(-4px)',
    transition: 'opacity 150ms ease, transform 150ms ease',
  }

  const overlayStyle: React.CSSProperties = {
    ...OVERLAY,
    opacity: animating ? 1 : 0,
    transition: 'opacity 150ms ease',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={TITLE}>Share conversation</div>
        <button
          style={BTN}
          onClick={onCopyLink}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-strong)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--bg-hover)' }}
        >
          Copy link
        </button>
        <button
          style={BTN}
          onClick={onGenerateUrl}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-strong)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--bg-hover)' }}
        >
          Generate public URL
        </button>
        <button
          style={CANCEL}
          onClick={onClose}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--ink-secondary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
