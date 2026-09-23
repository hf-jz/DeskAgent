import React, { useState, useRef, useCallback } from 'react'
import {
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
  Share,
  BookOpen,
  MoreHorizontal,
} from 'lucide-react'
import { ActionButton } from './ActionButton'
import { ShareModal } from './ShareModal'
import { SourcesList, type Source } from './SourcesList'
import { MoreDropdown, type MoreOption } from './MoreDropdown'
import { useMessageInteraction } from './MessageContext'

export interface MessageActionsProps {
  /** Message ID — used for per-message like/dislike/copy state */
  messageId: string
  /** Message content for clipboard copy */
  content: string
  /** Optional sources to show behind Sources button */
  sources?: Source[]
  /** Callbacks for the More dropdown */
  onRegenerate?: () => void
  onReport?: () => void
  onDelete?: () => void
}

const BAR: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  marginTop: '8px',
}

/**
 * ChatGPT-style action bar displayed permanently below assistant messages.
 * Contains 6 operations: Like, Dislike, Copy, Share, Sources, More.
 */
export function MessageActions({
  messageId,
  content,
  sources,
  onRegenerate,
  onReport,
  onDelete,
}: MessageActionsProps): React.JSX.Element {
  const {
    feedbackState,
    copiedMessageId,
    toggleLike,
    toggleDislike,
    copyMessage,
  } = useMessageInteraction()

  const [shareOpen, setShareOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  const liked = feedbackState[messageId]?.liked ?? false
  const disliked = feedbackState[messageId]?.disliked ?? false
  const isCopied = copiedMessageId === messageId

  // ── Copy handler ──
  const handleCopy = useCallback(() => {
    copyMessage({ id: messageId, role: 'assistant', content, createdAt: Date.now() })
  }, [messageId, content, copyMessage])

  // ── Share handlers ──
  const handleCopyLink = useCallback(() => {
    window.deskAppAPI?.writeClipboard?.(window.location.href)
    setShareOpen(false)
  }, [])

  const handleGenerateUrl = useCallback(() => {
    // Placeholder: in a real app this would call an API
    setShareOpen(false)
  }, [])

  // ── More dropdown options ──
  const moreOptions: MoreOption[] = [
    ...(onRegenerate ? [{ label: 'Regenerate response', onClick: onRegenerate }] : []),
    ...(onReport ? [{ label: 'Report', onClick: onReport, danger: true }] : []),
    ...(onDelete ? [{ label: 'Delete', onClick: onDelete, danger: true }] : []),
  ]

  return (
    <>
      <div style={BAR}>
        {/* Like */}
        <ActionButton
          icon={ThumbsUp}
          label={liked ? 'Unlike' : 'Good response'}
          active={liked}
          color={liked ? 'var(--ok)' : 'var(--ink-muted)'}
          activeColor="var(--ok)"
          onClick={() => toggleLike(messageId)}
        />

        {/* Dislike */}
        <ActionButton
          icon={ThumbsDown}
          label={disliked ? 'Remove dislike' : 'Bad response'}
          active={disliked}
          color={disliked ? 'var(--danger)' : 'var(--ink-muted)'}
          activeColor="var(--danger)"
          onClick={() => toggleDislike(messageId)}
        />

        {/* Copy */}
        <ActionButton
          icon={isCopied ? Check : Copy}
          label={isCopied ? 'Copied!' : 'Copy'}
          active={isCopied}
          color={isCopied ? 'var(--ok)' : 'var(--ink-muted)'}
          activeColor="var(--ok)"
          onClick={handleCopy}
          className={isCopied ? 'msg-action-copied' : undefined}
        />

        {/* Share */}
        <ActionButton
          icon={Share}
          label="Share"
          onClick={() => setShareOpen(true)}
          className="msg-action-share"
        />

        {/* Sources (conditional) */}
        {sources && sources.length > 0 && (
          <ActionButton
            icon={BookOpen}
            label="Sources"
          />
        )}

        {/* More */}
        <div className="msg-action-more" style={{ position: 'relative' }}>
          <button
            ref={moreBtnRef}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: 'none',
              background: moreOpen ? 'var(--ink)' : 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0,
              color: moreOpen ? 'var(--bg-page)' : 'var(--ink-muted)',
              transition: 'background 150ms ease, color 150ms ease',
            }}
            onClick={() => setMoreOpen(v => !v)}
            onMouseEnter={e => { if (!moreOpen) (e.currentTarget as HTMLElement).style.background = 'var(--ink)'; (e.currentTarget as HTMLElement).style.color = 'var(--bg-page)' }}
            onMouseLeave={e => { if (!moreOpen) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)' } }}
            aria-label="More"
          >
            <MoreHorizontal size={16} strokeWidth={1.8} />
          </button>
          {moreOpen && (
            <MoreDropdown
              options={moreOptions}
              onClose={() => setMoreOpen(false)}
              anchorRef={moreBtnRef}
            />
          )}
        </div>
      </div>

      {/* Sources list (expandable, below bar) */}
      {sources && sources.length > 0 && (
        <SourcesList sources={sources} />
      )}

      {/* Share modal */}
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onCopyLink={handleCopyLink}
        onGenerateUrl={handleGenerateUrl}
      />
    </>
  )
}
