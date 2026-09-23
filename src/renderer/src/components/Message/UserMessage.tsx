import React, { useState, useRef, useCallback, useEffect } from 'react'
import { t } from '../../lib/i18n'
import { Copy, Check, Pencil } from 'lucide-react'
import { ActionButton } from './ActionButton'
import './UserMessage.css'

/**
 * UserMessage wraps a user message in read/edit mode with a
 * ChatGPT-style hover action bar (Copy + Edit).
 *
 * Read mode: renders children (the message content) hugging the RIGHT
 *   edge of the window; the action bar sits BELOW the bubble, right-aligned,
 *   fading in on hover (opacity 0→1, translateY -3px→0, 150ms ease-out).
 *
 * Edit mode: replaces children with a textarea and Cancel/Save
 *   buttons. Save commits the new content via onSave; Cancel
 *   discards changes and returns to read mode.
 *
 * Copy: writes message content to navigator.clipboard. On
 *   success, the Copy button tooltip changes to "Copied!" for
 *   800 ms.
 *
 * Responsive:
 *   Desktop (>768px):  hover shows the toolbar
 *   Mobile  (≤768px):  tap/click toggles the toolbar
 */
export interface UserMessageProps {
  /** Raw text content (for copy & edit) */
  content: string
  /** Message identifier passed back on save */
  messageId: string
  /** Called with (messageId, newContent) when user saves an edit */
  onSave: (messageId: string, newContent: string) => void
  /** The rendered message content (e.g. <MarkdownContent />) in read mode */
  children: React.ReactNode
}

export function UserMessage({
  content,
  messageId,
  onSave,
  children,
}: UserMessageProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(content)
  const [copied, setCopied] = useState(false)
  const [tapped, setTapped] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Always sync editText with content when entering edit mode
  const handleEdit = useCallback(() => {
    setEditText(content)
    setEditing(true)
  }, [content])

  const handleSave = useCallback(() => {
    onSave(messageId, editText)
    setEditing(false)
  }, [messageId, editText, onSave])

  const handleCancel = useCallback(() => {
    setEditText(content)
    setEditing(false)
  }, [content])

  const handleCopy = useCallback(() => {
    window.deskAppAPI?.writeClipboard?.(content)
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 800)
  }, [content])

  // Mobile: toggle toolbar on tap/click
  const handleWrapperClick = useCallback((e: React.MouseEvent) => {
    // Don't toggle if clicking a button inside the toolbar (it has its own handler)
    if ((e.target as HTMLElement).closest('.user-message-actions button')) return
    setTapped(v => !v)
  }, [])

  // Close mobile toolbar on outside click
  useEffect(() => {
    if (!tapped) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setTapped(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tapped])

  // Cleanup copy timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const wrapperClass = `user-message${tapped ? ' user-message--tapped' : ''}`

  return (
    <div ref={wrapperRef} className={wrapperClass} onClick={handleWrapperClick}>
      {editing ? (
        <div className="user-message-edit">
          <textarea
            className="user-message-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <div className="user-message-edit-actions">
            <button
              className="user-message-edit-btn user-message-edit-btn--cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              className="user-message-edit-btn user-message-edit-btn--save"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {children}
          <div className="user-message-actions">
            {copied ? (
              /* ActionButton only renders label as a hover tooltip — the
                 "Copied!" feedback must be VISIBLE text, so swap to a custom
                 chip for the 800ms confirmation window. */
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 32, padding: '0 10px', borderRadius: 8,
                color: 'var(--ok, #22c55e)', fontSize: 11, fontWeight: 600,
                background: 'color-mix(in srgb, var(--ok, #22c55e) 12%, transparent)',
              }}>
                <Check size={14} strokeWidth={2.2} /> {t('common.copied')}
              </span>
            ) : (
              <ActionButton
                icon={Copy}
                label="Copy"
                onClick={handleCopy}
                tooltipDelay={0}
                color="var(--ink-muted)"
                activeColor="var(--ink)fff"
                hoverBg="var(--solid)"
              />
            )}
            <ActionButton
              icon={Pencil}
              label="Edit"
              onClick={handleEdit}
              color="var(--ink-muted)"
              activeColor="var(--ink)fff"
              hoverBg="var(--solid)"
            />
          </div>
        </>
      )}
    </div>
  )
}
