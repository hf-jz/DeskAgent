import { describe, it, expect } from 'vitest'
import { parseForgeOutput, isStopped } from '../src/shared/img2threejs-parser'

describe('parseForgeOutput', () => {
  it('parses a LOCAL_STATE line from forge/next.py', () => {
    const out = [
      'LOCAL_STATE status=active step=image-analysis pass=none loop=0/3 total=0/6',
      'next command: Read grimoire/intake/image_analysis.md and analyze /tmp/ref.png',
      'pending mandatory steps:',
      '- image-analysis',
      '- reference-suitability',
      '- reference-admission',
    ].join('\n')
    const s = parseForgeOutput(out)
    expect(s.status).toBe('active')
    expect(s.currentStep).toBe('image-analysis')
    expect(s.currentPass).toBeNull()
    expect(s.loopPass).toBe(0)
    expect(s.loopMax).toBe(3)
    expect(s.total).toBe(0)
    expect(s.totalMax).toBe(6)
    expect(s.nextCommand).toContain('grimoire/intake')
    expect(s.pending).toEqual(['image-analysis', 'reference-suitability', 'reference-admission'])
    expect(isStopped(s)).toBe(false)
  })

  it('parses a STATE line with an active pass and STOP reason', () => {
    const out = [
      'STATE status=stopped step=build-current-pass pass=blockout loop=3/3 total=6/6',
      'STOP: max correction iterations reached for blockout',
    ].join('\n')
    const s = parseForgeOutput(out)
    expect(s.status).toBe('stopped')
    expect(s.currentPass).toBe('blockout')
    expect(s.loopPass).toBe(3)
    expect(s.stopReason).toBe('max correction iterations reached for blockout')
    expect(isStopped(s)).toBe(true)
  })

  it('handles empty / garbage output without crashing', () => {
    const s = parseForgeOutput('')
    expect(s.status).toBe('unknown')
    expect(s.pending).toEqual([])
    const s2 = parseForgeOutput('python3: can\'t open file')
    expect(s2.currentStep).toBe('')
  })

  it('stops collecting pending steps once the block ends', () => {
    const out = [
      'LOCAL_STATE status=active step=spec-authoring pass=none loop=0/3 total=4/6',
      'pending mandatory steps:',
      '- spec-authoring',
      '- strict-validation',
      '',
      'some trailing unrelated text',
      '- not-a-pending-step',
    ].join('\n')
    const s = parseForgeOutput(out)
    expect(s.pending).toEqual(['spec-authoring', 'strict-validation'])
  })
})
