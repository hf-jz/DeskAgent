// ── assembleTurns — Pure function: raw messages → UI items (P0-9) ──
//
// Based on openworker's itemsFromMessages.ts (gui/src/itemsFromMessages.ts, 101 lines).
// Converts ChatMsg[] history + live AgentEvent stream into a stable RenderItem[]
// array for rendering. Zero React dependencies — testable in isolation.
//
// Input:  messages (historical ChatMsg[]) + live events (AgentEvent[])
// Output: RenderItem[] — sorted, grouped, ready for render

import type { AgentEvent, AgentTurn, TurnTool } from '../../../shared/agent-events'
import { t } from '../../lib/i18n'
import type { TaskTree } from '../../../shared/ipc-channels'

// ── ChatMsg (shared with BubbleApp, kept compatible) ──

export interface ChatMsg {
  id: string
  kind: 'user' | 'assistant' | 'reasoning' | 'reasoning_end' | 'tool_call' | 'tool_result'
  content: string
  name?: string
  args?: string
  elapsedSec?: number
  model?: string
  via?: string
}

// ── Render item types ──

export type RenderItemKind =
  | 'user-msg'
  | 'assistant-turn'
  | 'task-tree'
  | 'system-note'

export interface UserMsgItem {
  kind: 'user-msg'
  msg: ChatMsg
}

export interface AssistantTurnItem {
  kind: 'assistant-turn'
  turnId: string
  /** The full answer text (accumulated from assisant.delta events) */
  text: string
  /** Whether this turn is still streaming */
  streaming: boolean
  /** Reasoning text (for thinking panel) */
  reasoning: string
  /** Thinking blocks with real boundaries from the bridge ('reasoning.end'
   *  events); empty for turns recorded before that frame existed. */
  reasoningSegments?: string[]
  /** Tool calls made during this turn */
  tools: TurnTool[]
  /** Turn metadata */
  meta?: {
    model?: string
    via?: string
    elapsedMs?: number
  }
  /** Present if turn was interrupted */
  interrupted?: boolean
  /** Error message if turn ended with error */
  error?: string
}

export interface TaskTreeItem {
  kind: 'task-tree'
  tree: TaskTree
}

export interface SystemNoteItem {
  kind: 'system-note'
  text: string
}

export type RenderItem = UserMsgItem | AssistantTurnItem | TaskTreeItem | SystemNoteItem

// ── Assembly options ──

export interface AssembleOptions {
  messages: ChatMsg[]
  liveEvents: AgentEvent[]
  liveTree: TaskTree | null
}

// ── Core function ──

/**
 * Convert historical ChatMsg[] + live AgentEvent stream into a flat
 * RenderItem[] array ready for rendering.
 *
 * Strategy:
 * 1. Historical messages are mapped to user-msg items in order.
 * 2. Live AgentEvents with the same turnId are grouped into AgentTurn objects.
 * 3. Each AgentTurn becomes one assistant-turn item.
 * 4. Live tree (from orchestrator) becomes one task-tree item prepended before
 *    any incomplete assistant turn.
 */
export function assembleTurns(opts: AssembleOptions): RenderItem[] {
  const items: RenderItem[] = []
  const { messages, liveEvents, liveTree } = opts

  // ── Phase 1: historical messages ──
  // Walk through messages, extract assistant turns (bounded by user messages).
  // For simplicity and backwards compatibility, map all user+assistant messages.

  for (const msg of messages) {
    if (msg.kind === 'user') {
      items.push({ kind: 'user-msg', msg })
    }
    // Historical assistant turns are already baked into message history.
    // We don't need to re-create them from messages — the live events cover
    // the current streaming turn. Historical assistant messages pass through
    // as user-msg for the current BubbleApp compatibility (they are rendered
    // inline as msg bubbles). This is a transition step — after P0-8 TurnGroup
    // lands, historical turns will be fully reconstructed from AgentEvents.
  }

  // ── Phase 2: live events → AgentTurn grouping ──
  if (liveEvents.length > 0) {
    const turnMap = new Map<string, AgentTurn>()

    for (const ev of liveEvents) {
      let turn = turnMap.get(ev.turnId)
      if (!turn) {
        turn = {
          turnId: ev.turnId,
          events: [],
          reasoning: '',
          reasoningSegments: [],
          answer: '',
          streaming: true,
          tools: [],
        }
        turnMap.set(ev.turnId, turn)
      }
      turn.events.push(ev)

      switch (ev.type) {
        case 'reasoning.delta': {
          const text = ev.payload.text || ''
          turn.reasoning += text
          const segs = turn.reasoningSegments!
          if (segs.length === 0) segs.push('')
          segs[segs.length - 1] += text
          break
        }
        case 'reasoning.end':
          // real thinking-block boundary — next delta starts a new block
          turn.reasoningSegments!.push('')
          break
        case 'assistant.delta':
          turn.answer += (ev.payload.text || '')
          break
        case 'tool.started': {
          const tool: TurnTool = {
            name: ev.payload.tool?.name || 'tool',
            args: ev.payload.tool?.args || '{}',
            risk: ev.payload.tool?.risk,
            done: false,
          }
          turn.tools.push(tool)
          break
        }
        case 'tool.finished': {
          // Match the most recent unfinished tool with the same name
          for (let i = turn.tools.length - 1; i >= 0; i--) {
            if (turn.tools[i].name === ev.payload.tool?.name && !turn.tools[i].done) {
              turn.tools[i].done = true
              turn.tools[i].result = ev.payload.tool?.result
              break
            }
          }
          break
        }
        case 'turn.end':
          turn.streaming = false
          turn.meta = ev.payload.meta
          break
        case 'turn.interrupted':
          turn.streaming = false
          turn.interrupted = true
          turn.error = ev.payload.error
          break
        case 'turn.error':
          turn.streaming = false
          turn.error = ev.payload.error || 'Unknown error'
          break
      }
    }

    // Convert grouped turns to assistant-turn items (sorted by first event timestamp)
    const turns = [...turnMap.values()].sort((a, b) => {
      const aTs = a.events[0]?.ts ?? 0
      const bTs = b.events[0]?.ts ?? 0
      return aTs - bTs
    })

    for (const turn of turns) {
      // Insert live tree BEFORE an incomplete assistant turn if available
      if (liveTree && turn.streaming) {
        items.push({ kind: 'task-tree', tree: liveTree })
      }

      items.push({
        kind: 'assistant-turn',
        turnId: turn.turnId,
        text: turn.answer,
        streaming: turn.streaming,
        reasoning: turn.reasoning,
        // only carry real boundaries; undefined means "fall back to the regex splitter"
        reasoningSegments: (() => {
          const segs: string[] = (turn.reasoningSegments ?? []).filter((s: string) => s.trim())
          return segs.length > 0 ? segs : undefined
        })(),
        tools: turn.tools,
        meta: turn.meta,
        interrupted: turn.interrupted,
        error: turn.error,
      })

      if (turn.interrupted) {
        items.push({ kind: 'system-note', text: t('turn.interrupted') })
      } else if (turn.error) {
        items.push({ kind: 'system-note', text: `${t('turn.error')}: ${turn.error}` })
      }
    }
  }

  return items
}

// ── Helpers to reconstruct historical turns from messages (for P0-8 transition) ──

/**
 * Given flat ChatMsg[] history, detect turn boundaries (user message marks a
 * new turn) and group messages into AgentTurn objects. This bridges the gap
 * until P0-6 SQLite stores native AgentEvents.
 */
export function reconstructTurnsFromMessages(messages: ChatMsg[]): Array<{
  userMsg: ChatMsg
  assistantMsgs: ChatMsg[]
}> {
  const turns: Array<{ userMsg: ChatMsg; assistantMsgs: ChatMsg[] }> = []
  let currentUser: ChatMsg | null = null
  let currentAssistant: ChatMsg[] = []

  for (const msg of messages) {
    if (msg.kind === 'user') {
      if (currentUser && currentAssistant.length > 0) {
        turns.push({ userMsg: currentUser, assistantMsgs: [...currentAssistant] })
      }
      currentUser = msg
      currentAssistant = []
    } else {
      currentAssistant.push(msg)
    }
  }
  if (currentUser && currentAssistant.length > 0) {
    turns.push({ userMsg: currentUser, assistantMsgs: [...currentAssistant] })
  }

  return turns
}
