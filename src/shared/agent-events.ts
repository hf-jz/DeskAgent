// ── Unified Agent Event Contract (P0-1) ──
//
// Single AgentEvent union type that ALL producers (bridge.py / orchestrator /
// hermes-gateway) must emit, and ALL renderers (bubble / pet / task) consume.
// Based on openworker's EventType 14-event model (coworker/events.py).

import type { TokenUsage, DoneMeta, TaskTree } from './ipc-channels'

// ── Event types ──

export type AgentEventType =
  | 'turn.start'
  | 'assistant.delta'
  | 'reasoning.delta'
  | 'reasoning.end'      // thinking block closed (explicit boundary from the bridge)
  | 'tool.proposed'
  | 'tool.started'
  | 'tool.finished'
  | 'permission.required'  // Phase 6 execution-gate (bridge approval callback)
  | 'plan.proposed'        // maps to orchestrator's tree planning complete
  | 'turn.end'
  | 'turn.interrupted'
  | 'turn.error'

// ── Tool risk classification (P0-3 compatible) ──

export type RiskClass = 'read' | 'write-low' | 'write-high' | 'destructive'

export interface ToolEventPayload {
  name: string
  args?: string
  result?: string
  risk?: RiskClass
}

// ── The canonical event shape ──

export interface AgentEvent {
  v: 1
  /** Per-turn unique ID — produced by the first event of a turn, used by
   *  renderers to group events across the same turn. */
  turnId: string
  /** Monotonic timestamp (ms) — producer sets this */
  ts: number
  type: AgentEventType
  payload: {
    text?: string            // delta text
    tool?: ToolEventPayload  // tool lifecycle
    plan?: TaskTree          // task-tree plan from orchestrator
    meta?: {
      model?: string
      provider?: string
      via?: string
      elapsedMs?: number
      tokens?: TokenUsage
    }
    error?: string           // error message (turn.error)
    /** permission.required payload (Phase 6) */
    permission?: {
      id: string
      command: string
      description: string
      allowPermanent: boolean
      smartDenied: boolean
    }
  }
}

// ── Turn-level derived data (for assembleTurns) ──

/** A synthesized turn: all events + the final answer text grouped together. */
export interface AgentTurn {
  turnId: string
  events: AgentEvent[]
  /** Approximates the reasoning text from reasoning.delta events */
  reasoning: string
  /** Thinking blocks split at real 'reasoning.end' boundaries (empty/absent
   *  for turns recorded before the bridge emitted that frame) */
  reasoningSegments?: string[]
  /** Approximates the final answer text from assistant.delta events */
  answer: string
  /** Whether this turn is still streaming (no turn.end / turn.interrupted yet) */
  streaming: boolean
  /** Tool call/result pairs, ordered by occurrence */
  tools: TurnTool[]
  /** Metadata from turn.end */
  meta?: {
    model?: string
    via?: string
    elapsedMs?: number
    tokens?: TokenUsage
  }
  /** Error message if turn ended with turn.error or was interrupted */
  error?: string
  /** True if turn was interrupted (partial answer preserved) */
  interrupted: boolean
}

export interface TurnTool {
  name: string
  args: string
  /** Tool result (available after tool.finished) */
  result?: string
  risk?: RiskClass
  /** Whether result has arrived */
  done: boolean
}
