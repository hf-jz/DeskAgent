// P1-B4 #24: hermetic unit tests for the pure message→render assembly layer.
import { describe, it, expect } from 'vitest'
import { assembleTurns, reconstructTurnsFromMessages, type ChatMsg } from '../src/renderer/src/bubble/lib/assembleTurns'
import type { AgentEvent } from '../src/shared/agent-events'

const ev = (turnId: string, type: string, ts: number, payload: any = {}): AgentEvent =>
  ({ turnId, ts, type, payload } as unknown as AgentEvent)

const user = (id: string, content: string): ChatMsg => ({ id, kind: 'user', content })

describe('assembleTurns', () => {
  it('empty input → empty output', () => {
    expect(assembleTurns({ messages: [], liveEvents: [], liveTree: null })).toEqual([])
  })

  it('historical user messages become user-msg items in order', () => {
    const items = assembleTurns({ messages: [user('u1', 'hi'), user('u2', 'yo')], liveEvents: [], liveTree: null })
    expect(items.map(i => i.kind)).toEqual(['user-msg', 'user-msg'])
  })

  it('groups live events by turnId, deltas accumulate', () => {
    const items = assembleTurns({
      messages: [],
      liveEvents: [
        ev('t1', 'assistant.delta', 1, { text: 'Hello' }),
        ev('t1', 'reasoning.delta', 2, { text: 'think' }),
        ev('t1', 'assistant.delta', 3, { text: ' world' }),
        ev('t2', 'assistant.delta', 4, { text: 'second' }),
      ],
      liveTree: null,
    })
    const turns = items.filter(i => i.kind === 'assistant-turn') as any[]
    expect(turns).toHaveLength(2)
    expect(turns[0].text).toBe('Hello world')
    expect(turns[0].reasoning).toBe('think')
    expect(turns[0].streaming).toBe(true)
    expect(turns[1].text).toBe('second')
  })

  it('tool.started pairs with the most recent unfinished same-name tool.finished', () => {
    const items = assembleTurns({
      messages: [],
      liveEvents: [
        ev('t1', 'tool.started', 1, { tool: { name: 'terminal', args: 'ls' } }),
        ev('t1', 'tool.started', 2, { tool: { name: 'terminal', args: 'pwd' } }),
        ev('t1', 'tool.finished', 3, { tool: { name: 'terminal', result: 'ok' } }),
      ],
      liveTree: null,
    })
    const turn = items.find(i => i.kind === 'assistant-turn') as any
    expect(turn.tools).toHaveLength(2)
    expect(turn.tools[0].done).toBe(false)  // first one still running
    expect(turn.tools[1].done).toBe(true)   // latest matched first
    expect(turn.tools[1].result).toBe('ok')
  })

  it('turn.end stops streaming and carries meta', () => {
    const items = assembleTurns({
      messages: [],
      liveEvents: [ev('t1', 'assistant.delta', 1, { text: 'x' }), ev('t1', 'turn.end', 2, { meta: { model: 'm1' } })],
      liveTree: null,
    })
    const turn = items.find(i => i.kind === 'assistant-turn') as any
    expect(turn.streaming).toBe(false)
    expect(turn.meta?.model).toBe('m1')
  })

  it('interrupted turn appends a system-note', () => {
    const items = assembleTurns({
      messages: [],
      liveEvents: [ev('t1', 'turn.interrupted', 1, { error: 'aborted' })],
      liveTree: null,
    })
    const note = items.find(i => i.kind === 'system-note') as any
    expect(note.text).toContain('中断')
  })

  it('live tree is inserted before a streaming turn only', () => {
    const tree = { nodes: [] } as any
    const items = assembleTurns({
      messages: [],
      liveEvents: [
        ev('t1', 'turn.end', 1, {}),                    // finished turn → no tree
        ev('t2', 'assistant.delta', 2, { text: 'x' }),  // streaming → tree before it
      ],
      liveTree: tree,
    })
    const kinds = items.map(i => i.kind)
    expect(kinds).toEqual(['assistant-turn', 'task-tree', 'assistant-turn'])
  })
})

describe('reconstructTurnsFromMessages', () => {
  it('splits history at user boundaries', () => {
    const msgs: ChatMsg[] = [
      user('u1', 'q1'),
      { id: 'a1', kind: 'assistant', content: 'a1' },
      user('u2', 'q2'),
      { id: 'a2', kind: 'assistant', content: 'a2' },
      { id: 'a3', kind: 'tool_call', content: 'tc' },
    ]
    const turns = reconstructTurnsFromMessages(msgs)
    expect(turns).toHaveLength(2)
    expect(turns[0].assistantMsgs).toHaveLength(1)
    expect(turns[1].assistantMsgs).toHaveLength(2)
  })
})
