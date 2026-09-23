import { describe, it, expect } from 'vitest'
import {
  TaskPhase, isTerminalPhase, setCondition, getCondition, conditionTrue,
  type TaskCondition,
} from '../src/shared/task-state'

describe('task state vocabulary', () => {
  it('phase set is closed and terminal detection is correct', () => {
    expect(Object.values(TaskPhase)).toEqual(['pending', 'running', 'suspended', 'failed', 'done', 'terminating'])
    expect(isTerminalPhase(TaskPhase.done)).toBe(true)
    expect(isTerminalPhase(TaskPhase.failed)).toBe(true)
    expect(isTerminalPhase(TaskPhase.suspended)).toBe(false) // resumable, not terminal
    expect(isTerminalPhase(TaskPhase.terminating)).toBe(false)
  })

  it('setCondition adds a new condition', () => {
    const list = setCondition(undefined, { type: 'BridgeReady', status: 'True', reason: 'Warm', message: 'spare adopted' }, 1000)
    expect(list).toEqual([{ type: 'BridgeReady', status: 'True', reason: 'Warm', message: 'spare adopted', lastTransitionAt: 1000 }])
  })

  it('re-setting the same status keeps lastTransitionAt (ax reconciler semantics)', () => {
    let list: TaskCondition[] = setCondition(undefined, { type: 'Ready', status: 'True', reason: 'TurnRunning', message: '' }, 1000)
    list = setCondition(list, { type: 'Ready', status: 'True', reason: 'TurnRunning', message: 'updated msg' }, 5000)
    expect(list).toHaveLength(1)
    expect(list[0].message).toBe('updated msg')
    expect(list[0].lastTransitionAt).toBe(1000) // unchanged: no real transition
  })

  it('a status flip bumps lastTransitionAt and keeps other conditions untouched', () => {
    let list = setCondition(undefined, { type: 'Ready', status: 'True', reason: 'TurnRunning', message: '' }, 1000)
    list = setCondition(list, { type: 'WorkspaceReady', status: 'True', reason: 'SetupComplete', message: '' }, 2000)
    list = setCondition(list, { type: 'Ready', status: 'False', reason: 'ApprovalPending', message: 'waiting' }, 3000)
    expect(list).toHaveLength(2)
    expect(getCondition(list, 'Ready')).toMatchObject({ status: 'False', lastTransitionAt: 3000 })
    expect(getCondition(list, 'WorkspaceReady')).toMatchObject({ status: 'True', lastTransitionAt: 2000 })
    expect(conditionTrue(list, 'WorkspaceReady')).toBe(true)
    expect(conditionTrue(list, 'Ready')).toBe(false)
  })

  it('does not mutate the input list', () => {
    const before: TaskCondition[] = setCondition(undefined, { type: 'Ready', status: 'False', reason: 'Idle', message: '' }, 1)
    const snapshot = JSON.stringify(before)
    setCondition(before, { type: 'Ready', status: 'True', reason: 'TurnRunning', message: '' }, 2)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
