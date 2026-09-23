import { useEffect, useRef, useState } from 'react'
import { calcTurnCost } from './useTokenBudget'
import type { AgentEvent, AgentTurn, TurnTool } from '../../../shared/agent-events'
import { createStreamGate, type StreamGateState } from '../../lib/streamGate'

interface ChatMsg {
  id: string
  kind: string
  content: string
  name?: string
  args?: string
  elapsedSec?: number
  model?: string
  via?: string
}

interface UseIpcStreamOptions {
  setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string>>
  setTokenUsage: React.Dispatch<React.SetStateAction<{ total: number; prompt: number; completion: number; context?: number } | null>>
  onCumulativeCost: (cost: number) => void
  onTurnMeta?: (meta: { model?: string; elapsedMs: number }) => void
  onTurnStart?: (model: string) => void
  /** Fired when a send is queued behind a running task (bridge is serial). */
  onQueued?: (queueLen: number) => void
  turnStartRef: React.MutableRefObject<number | null>
}

export interface IpcStreamState {
  /** P0-1/P0-8: canonical live turn folded from AgentEvents (null when idle) */
  liveTurn: AgentTurn | null
  /** P0-7: stream gate state — 'hold' suppresses the answer bubble until promoted */
  gateState: StreamGateState
}

/** Incrementally fold one AgentEvent into the live turn (single-turn version
 *  of assembleTurns Phase 2). A turn.start with a new turnId starts fresh. */
function foldEvent(prev: AgentTurn | null, ev: AgentEvent): AgentTurn {
  let turn: AgentTurn = prev && prev.turnId === ev.turnId
    ? { ...prev, events: [...prev.events, ev] }
    : { turnId: ev.turnId, events: [ev], reasoning: '', answer: '', streaming: true, tools: [] }

  switch (ev.type) {
    case 'reasoning.delta':
      turn.reasoning += (ev.payload.text || '')
      break
    case 'assistant.delta':
      turn.answer += (ev.payload.text || '')
      break
    case 'tool.started':
      turn.tools = [...turn.tools, {
        name: ev.payload.tool?.name || 'tool',
        args: ev.payload.tool?.args || '{}',
        risk: ev.payload.tool?.risk,
        done: false,
      }]
      break
    case 'tool.finished': {
      const tools: TurnTool[] = [...turn.tools]
      for (let i = tools.length - 1; i >= 0; i--) {
        if (tools[i].name === ev.payload.tool?.name && !tools[i].done) {
          tools[i] = { ...tools[i], done: true, result: ev.payload.tool?.result }
          break
        }
      }
      turn.tools = tools
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
  return turn
}

/**
 * Sets up all IPC event listeners for streaming agent responses.
 * Handles: task chunks, reasoning, tool calls/results, token usage, done/error.
 * Also folds the canonical AgentEvent stream into a live turn (P0-1/P0-8)
 * and runs the three-state stream gate (P0-7).
 */
export function useIpcStream(opts: UseIpcStreamOptions): IpcStreamState {
  const { setMessages, setStreaming, setError, setTokenUsage, onCumulativeCost, onTurnMeta, onTurnStart, onQueued, turnStartRef } = opts
  // Token usage accumulated across the turn — settled into cost when done-meta arrives.
  const pendingUsageRef = useRef({ prompt: 0, completion: 0 })
  // Tool start timestamps — tool_call fires at start, tool_result at end;
  // real duration is measured between the two (fixes the always-0ms timeline).
  const toolStartRef = useRef<Map<string, number>>(new Map())

  // P0-1/P0-8: canonical live turn (event-driven rendering)
  const [liveTurn, setLiveTurn] = useState<AgentTurn | null>(null)
  // P0-7: stream gate — answer bubble appears only after promotion
  const [gateState, setGateState] = useState<StreamGateState>('idle')
  const gateRef = useRef(createStreamGate())
  const answerRef = useRef('')

  useEffect(() => {
    const cleanup: (() => void)[] = []

    // P0-1: unified canonical event stream → live turn + stream gate.
    // Optional-chained so older preloads without onAgentEvent degrade cleanly.
    const unsubAgentEvent = window.deskAppAPI.onAgentEvent?.((ev: AgentEvent) => {
      const gate = gateRef.current
      switch (ev.type) {
        case 'turn.start':
          answerRef.current = ''
          gate.onTurnStart()
          setGateState(gate.state)
          break
        case 'assistant.delta':
          answerRef.current += (ev.payload.text || '')
          setGateState(gate.onDelta(answerRef.current))
          break
        case 'turn.end':
        case 'turn.interrupted':
        case 'turn.error':
          gate.onTurnEnd()
          setGateState(gate.state)
          break
      }
      setLiveTurn(prev => foldEvent(prev, ev))
    })
    if (unsubAgentEvent) cleanup.push(unsubAgentEvent)

    cleanup.push(window.deskAppAPI.onTaskChunk((text) => {
      onQueued?.(false) // first real output → no longer queued
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.kind === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: last.content + text }]
        }
        if (!text.trim()) return prev
        return [...prev, { id: 'a-' + Date.now(), kind: 'assistant', content: text }]
      })
    }))

    cleanup.push(window.deskAppAPI.onTaskQueued((n) => {
      onQueued?.(n)
    }))

    cleanup.push(window.deskAppAPI.onTaskDone(() => {
      onQueued?.(false)
      setStreaming(false)
      // Create-intent: the agent's first line CREATE_INTENT: {...} → open the
      // creation workspace window with the parsed payload.
      try {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          const text = last?.kind === 'assistant' ? last.content : ''
          const m = text.match(/CREATE_INTENT:\s*(\{[\s\S]*?\})/)
          if (m) {
            const p = JSON.parse(m[1])
            if (p?.source) window.deskAppAPI.openCreate({ source: p.source, title: p.title || '作品', type: p.type || 'presentation' })
          }
          // img2threejs intent → open the forge pipeline console window
          const m3d = text.match(/IMG2THREEJS_INTENT:\s*(\{[\s\S]*?\})/)
          if (m3d) {
            const p = JSON.parse(m3d[1])
            if (p?.reference) window.deskAppAPI.openImg2ThreeJs()
          }
          return prev
        })
      } catch { /* intent parse failed — treat as normal reply */ }
      if (turnStartRef.current) {
        const elapsed = Math.max(1, Math.round((Date.now() - turnStartRef.current) / 1000))
        // Stamp elapsed time onto the last assistant message so each turn
        // keeps its own duration (previously a single global value made
        // every history card show the most recent turn's time).
        setMessages(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].kind === 'assistant') {
              const next = [...prev]
              next[i] = { ...next[i], elapsedSec: elapsed }
              return next
            }
          }
          return prev
        })
      }
      turnStartRef.current = null
    }))

    cleanup.push(window.deskAppAPI.onTaskError((err) => {
      onQueued?.(false)
      setError(err)
      setStreaming(false)
      turnStartRef.current = null
      try { (window as any).deskAppAPI?.genui?.log?.('[bubble] task:error:', String(err).slice(0, 120)) } catch {}
    }))

    // P0-2a: graceful interrupt — partial answer stays in the message list,
    // streaming state finalizes (idempotent: abort path may emit twice).
    cleanup.push(window.deskAppAPI.onTaskInterrupted(() => {
      onQueued?.(false)
      setStreaming(false)
      turnStartRef.current = null
      setMessages(prev => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].kind === 'assistant') {
            const next = [...prev]
            next[i] = { ...next[i], via: '已中断' }
            return next
          }
        }
        return prev
      })
    }))

    cleanup.push(window.deskAppAPI.onReasoningChunk((text) => {
      if (!turnStartRef.current) turnStartRef.current = Date.now()
      setMessages(prev => [
        ...prev,
        {
          id: 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          kind: 'reasoning',
          content: text,
        },
      ])
    }))

    // Explicit thinking-block boundary from the bridge (frame 'reasoning_end'):
    // recorded as a marker so the timeline splits on real boundaries instead of
    // regex-guessing where the model stopped thinking.
    cleanup.push(window.deskAppAPI.onReasoningEnd(() => {
      setMessages(prev => [...prev, { id: 're-' + Date.now(), kind: 'reasoning_end', content: '' }])
    }))

    cleanup.push(window.deskAppAPI.onToolCall((name, args) => {
      toolStartRef.current.set(name, Date.now())
      setMessages(prev => [...prev, { id: 'tc-' + Date.now(), kind: 'tool_call', content: '', name, args }])
    }))

    cleanup.push(window.deskAppAPI.onToolResult((name, content) => {
      const start = toolStartRef.current.get(name)
      toolStartRef.current.delete(name)
      const durationMs = start ? Math.max(0, Date.now() - start) : 0
      const success = !/^(error|Error|❌|失败|Exception)/.test((content || '').trim())
      window.deskAppAPI.trackToolCall?.(name, success, durationMs)
      setMessages(prev => [...prev, { id: 'tr-' + Date.now(), kind: 'tool_result', content, name }])
    }))

    cleanup.push(window.deskAppAPI.onTokenUsage((usage) => {
      const prompt = usage.promptTokens || 0
      const completion = usage.completionTokens || 0
      pendingUsageRef.current.prompt += prompt
      pendingUsageRef.current.completion += completion
      setTokenUsage({ total: prompt + completion, prompt, completion, context: usage.contextTokens || 0 })
    }))

    cleanup.push(window.deskAppAPI.onTurnStartMeta((meta) => {
      if (meta?.model) onTurnStart?.(meta.model)
    }))

    cleanup.push(window.deskAppAPI.onTurnDoneMeta((meta) => {
      // Settle the turn's cost with the model that actually ran it
      const { prompt, completion } = pendingUsageRef.current
      if (prompt + completion > 0) {
        onCumulativeCost(calcTurnCost({ total: prompt + completion, prompt, completion }, meta.model))
      }
      pendingUsageRef.current = { prompt: 0, completion: 0 }
      onTurnMeta?.({ model: meta.model, elapsedMs: meta.elapsedMs || 0 })
      // Stamp the model onto the last assistant message for transparency
      if (meta.model) {
        const model = meta.model
        const via = meta.via as string | undefined
        setMessages(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].kind === 'assistant') {
              const next = [...prev]
              next[i] = { ...next[i], model, via }
              return next
            }
          }
          return prev
        })
      }
    }))

    return () => cleanup.forEach(fn => fn())
  }, [])

  return { liveTurn, gateState }
}
