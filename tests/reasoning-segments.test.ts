import { describe, it, expect } from 'vitest'
import { reasoningSegments } from '../src/renderer/src/bubble/lib/reasoningSegments'

const r = (content: string) => ({ kind: 'reasoning', content })
const END = { kind: 'reasoning_end', content: '' }
const tool = (name: string) => ({ kind: 'tool_call', content: '', name })

describe('reasoningSegments', () => {
  it('returns [] when the turn has no boundary markers (legacy fallback)', () => {
    expect(reasoningSegments([r('a'), r('b'), tool('terminal')])).toEqual([])
  })

  it('splits on markers, in order', () => {
    const history = [r('think one'), END, tool('terminal'), r('think two'), END]
    expect(reasoningSegments(history)).toEqual(['think one', 'think two'])
  })

  it('keeps an unclosed trailing block (streaming / aborted mid-thought)', () => {
    const history = [r('first'), END, r('still thinking')]
    expect(reasoningSegments(history)).toEqual(['first', 'still thinking'])
  })

  it('drops empty blocks (marker with no reasoning between them)', () => {
    expect(reasoningSegments([END, END, r('only'), END])).toEqual(['only'])
  })

  it('joins deltas inside one block', () => {
    expect(reasoningSegments([r('a'), r('b'), r('c'), END])).toEqual(['abc'])
  })
})
