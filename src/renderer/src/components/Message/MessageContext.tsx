import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { Message } from '../../types/message'

/**
 * Per-message feedback state.
 */
export interface FeedbackState {
  [messageId: string]: {
    liked?: boolean
    disliked?: boolean
    copied?: boolean
  }
}

/**
 * Global interaction state for the message action bar.
 * Manages hover, edit, copy, and feedback (like/dislike) state across messages.
 */
export interface MessageInteractionState {
  /** ID of the message currently being hovered, or null */
  hoverMessageId: string | null
  /** ID of the message currently being edited, or null */
  editingMessageId: string | null
  /** ID of the message whose content was just copied, or null */
  copiedMessageId: string | null
  /** Per-message like/dislike/copy state */
  feedbackState: FeedbackState

  setHoverMessageId: (id: string | null) => void
  setEditingMessageId: (id: string | null) => void
  setCopiedMessageId: (id: string | null) => void

  /** Toggle like for a message (clears dislike if setting like) */
  toggleLike: (messageId: string) => void
  /** Toggle dislike for a message (clears like if setting dislike) */
  toggleDislike: (messageId: string) => void
  /** Mark a message as copied */
  markCopied: (messageId: string) => void
  /** Copy message content to clipboard and signal via copiedMessageId */
  copyMessage: (message: Message) => void
}

const MessageInteractionCtx = createContext<MessageInteractionState | null>(null)

export function useMessageInteraction(): MessageInteractionState {
  const ctx = useContext(MessageInteractionCtx)
  if (!ctx) {
    throw new Error('useMessageInteraction must be used within a MessageInteractionProvider')
  }
  return ctx
}

export function MessageInteractionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [hoverMessageId, setHoverMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({})

  // Track the copiedMessageId timeout so we can clear it on new copies
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggleLike = useCallback((messageId: string) => {
    setFeedbackState(prev => {
      const current = prev[messageId]
      if (current?.liked) {
        // Remove like
        const { liked, ...rest } = current
        return { ...prev, [messageId]: rest }
      }
      // Set like, clear dislike
      return { ...prev, [messageId]: { ...current, liked: true, disliked: false } }
    })
  }, [])

  const toggleDislike = useCallback((messageId: string) => {
    setFeedbackState(prev => {
      const current = prev[messageId]
      if (current?.disliked) {
        // Remove dislike
        const { disliked, ...rest } = current
        return { ...prev, [messageId]: rest }
      }
      // Set dislike, clear like
      return { ...prev, [messageId]: { ...current, disliked: true, liked: false } }
    })
  }, [])

  const markCopied = useCallback((messageId: string) => {
    setFeedbackState(prev => ({
      ...prev,
      [messageId]: { ...prev[messageId], copied: true },
    }))
  }, [])

  const copyMessage = useCallback((message: Message) => {
    window.deskAppAPI?.writeClipboard?.(message.content)
    setCopiedMessageId(message.id)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopiedMessageId(null), 2000)
  }, [])

  const value: MessageInteractionState = {
    hoverMessageId,
    editingMessageId,
    copiedMessageId,
    feedbackState,
    setHoverMessageId,
    setEditingMessageId,
    setCopiedMessageId,
    toggleLike,
    toggleDislike,
    markCopied,
    copyMessage,
  }

  return (
    <MessageInteractionCtx.Provider value={value}>
      {children}
    </MessageInteractionCtx.Provider>
  )
}
