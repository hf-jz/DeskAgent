// ── Agent Event Bus (P0-1) ──
//
// Translates heterogeneous producer events (bridge.py JSONL, orchestrator
// callbacks, hermes-gateway) into the canonical AgentEvent format.
//
// Architecture:
//   bridge.py events  ─┐
//   orchestrator cbs  ─┤── event-bus.ts ──→ agent:event IPC push ──→ renderer
//   gateway (future)  ─┘

import { WebContents } from 'electron'
import type { AgentEvent, RiskClass } from '../../shared/agent-events'
import type { TokenUsage, DoneMeta, TaskTree } from '../../shared/ipc-channels'

// ── Turn ids ──

let turnCounter = 0

export function newTurnId(): string {
  turnCounter++
  return `turn-${Date.now()}-${turnCounter}`
}

function now(): number {
  return Date.now()
}

// ── Emitter ──

export interface EventBus {
  /** Push a single AgentEvent to the renderer via `agent:event` IPC. */
  emit: (event: AgentEvent) => void
  /** Current turnId (undefined when no active turn). */
  readonly turnId: string | undefined
  /** Set/clear the active turnId. */
  setTurnId: (id: string | undefined) => void
}

export function createEventBus(wc: WebContents): EventBus {
  let _turnId: string | undefined
  return {
    emit(event: AgentEvent): void {
      if (wc.isDestroyed()) return
      wc.send('agent:event', event)
    },
    get turnId() { return _turnId },
    setTurnId(id: string | undefined) { _turnId = id },
  }
}

function emitTo(bus: EventBus, turnId: string | undefined, type: AgentEvent['type'], payload: AgentEvent['payload']): void {
  if (!turnId) return
  bus.emit({ v: 1, turnId, ts: now(), type, payload })
}

// ── Bridge adapter ──

/** Bridge v2 callbacks (subset of TaskStreamCallbacks) */
export interface BridgeCallbacks {
  onChunk: (text: string) => void
  onReasoning: (text: string) => void
  /** reasoning block closed — explicit boundary, no inference needed */
  onReasoningEnd?: () => void
  onToolCall: (name: string, args: string) => void
  onToolResult: (name: string, content: string) => void
  onTokens: (usage: TokenUsage) => void
  onDoneMeta: (meta: DoneMeta) => void
  onDone: () => void
  onError: (err: string) => void
  onInterrupted?: (partial: string) => void
  /** Phase 6: execution-gate approval lifecycle */
  onPermissionRequired?: (req: { id: string; command: string; description: string; allowPermanent: boolean; smartDenied: boolean }) => void
  onPermissionResolved?: (id: string, reason: 'timeout' | 'abort' | 'responded') => void
}

/**
 * Wrap bridge callbacks so every callback ALSO emits canonical AgentEvents.
 * The bus turnId must already be set (handler emits turn.start first).
 */
export function wrapBridgeCallbacks(bus: EventBus, original: BridgeCallbacks): BridgeCallbacks {
  let ended = false

  const endOnce = (payload: AgentEvent['payload']): void => {
    if (ended) return
    ended = true
    emitTo(bus, bus.turnId, 'turn.end', payload)
    bus.setTurnId(undefined)
  }

  return {
    onChunk: (text: string) => {
      original.onChunk(text)
      emitTo(bus, bus.turnId, 'assistant.delta', { text })
    },
    onReasoning: (text: string) => {
      original.onReasoning(text)
      emitTo(bus, bus.turnId, 'reasoning.delta', { text })
    },
    onReasoningEnd: () => {
      original.onReasoningEnd?.()
      emitTo(bus, bus.turnId, 'reasoning.end', {})
    },
    onToolCall: (name: string, args: string) => {
      original.onToolCall(name, args)
      let risk: RiskClass | undefined
      try {
        const { classifyTool } = require('./risk')
        risk = classifyTool(name, args)
      } catch { /* risk classification unavailable */ }
      emitTo(bus, bus.turnId, 'tool.started', { tool: { name, args, risk } })
    },
    onToolResult: (name: string, content: string) => {
      original.onToolResult(name, content)
      emitTo(bus, bus.turnId, 'tool.finished', { tool: { name, result: content } })
    },
    onTokens: (usage: TokenUsage) => original.onTokens(usage),
    onDoneMeta: (meta: DoneMeta) => {
      original.onDoneMeta(meta)
      endOnce({
        meta: {
          model: meta.model,
          provider: meta.provider,
          via: (meta as any).via,
          elapsedMs: meta.elapsedMs,
        },
      })
    },
    onDone: () => {
      original.onDone()
      // Gateway/fallback path has no done-meta — still close the turn.
      endOnce({})
    },
    onError: (err: string) => {
      original.onError(err)
      if (!ended) {
        ended = true
        emitTo(bus, bus.turnId, 'turn.error', { error: err })
        bus.setTurnId(undefined)
      }
    },
    onInterrupted: (partial: string) => {
      original.onInterrupted?.(partial)
      if (!ended) {
        ended = true
        emitTo(bus, bus.turnId, 'turn.interrupted', { error: 'interrupted' })
        bus.setTurnId(undefined)
      }
    },
    onPermissionRequired: (req) => {
      original.onPermissionRequired?.(req)
      emitTo(bus, bus.turnId, 'permission.required', {
        permission: {
          id: req.id,
          command: req.command,
          description: req.description,
          allowPermanent: req.allowPermanent,
          smartDenied: req.smartDenied,
        },
      })
    },
    onPermissionResolved: (id, reason) => {
      original.onPermissionResolved?.(id, reason)
    },
  }
}

// ── Orchestrator adapter ──

export interface OrchestratorEventAdapters {
  /** Plan parsed → plan.proposed (fires once, on first non-empty tree) */
  onTree: (tree: TaskTree) => void
  /** Review answer chunk → assistant.delta */
  onAnswer: (text: string) => void
  onError: (err: string) => void
  onDone: () => void
}

export function createOrchestratorAdapters(bus: EventBus, turnId: string): OrchestratorEventAdapters {
  let planEmitted = false
  let ended = false

  const endOnce = (type: 'turn.end' | 'turn.error', payload: AgentEvent['payload']): void => {
    if (ended) return
    ended = true
    bus.emit({ v: 1, turnId, ts: now(), type, payload })
    if (bus.turnId === turnId) bus.setTurnId(undefined)
  }

  return {
    onTree: (tree: TaskTree) => {
      if (planEmitted || !tree.nodes.length) return
      planEmitted = true
      bus.emit({ v: 1, turnId, ts: now(), type: 'plan.proposed', payload: { plan: tree } })
    },
    onAnswer: (text: string) => {
      bus.emit({ v: 1, turnId, ts: now(), type: 'assistant.delta', payload: { text } })
    },
    onError: (err: string) => endOnce('turn.error', { error: err }),
    onDone: () => endOnce('turn.end', {}),
  }
}
