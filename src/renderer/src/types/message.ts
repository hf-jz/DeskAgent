/**
 * Unified message type for the ChatGPT-style action bar infrastructure.
 * This is the canonical message shape — adapters from existing ChatMsg
 * or other sources should conform to this interface.
 */
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  actions?: {
    liked?: boolean
    disliked?: boolean
    copied?: boolean
  }
}
