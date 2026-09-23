// genui spec validation — trust boundary for LLM-generated window specs.
import { describe, it, expect } from 'vitest'
import { validateSpec, COMPONENT_KINDS, webhookBody, applyPatch, rectOverlapRatio } from '../src/shared/gen-ui-types'

const valid = {
  id: 'win-1', title: 'T', kind: 'feed',
  cron: { schedule: '0 9 * * *', prompt: 'search {{topic}}' },
  props: { topic: 'AI' },
}

describe('validateSpec', () => {
  it('accepts a valid spec', () => {
    const r = validateSpec(valid)
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.cron?.standingGrants).toEqual([])
  })
  it('rejects non-object / missing id / missing title', () => {
    expect('error' in (validateSpec(null) as any)).toBe(true)
    expect('error' in (validateSpec({ ...valid, id: '' }) as any)).toBe(true)
    expect('error' in (validateSpec({ ...valid, title: 1 }) as any)).toBe(true)
  })
  it('rejects unknown component kind (whitelist)', () => {
    const r = validateSpec({ ...valid, kind: 'evil-script' }) as any
    expect(r.error).toMatch(/unknown kind/)
  })
  it('rejects malformed cron', () => {
    expect('error' in (validateSpec({ ...valid, cron: { schedule: 1 } }) as any)).toBe(true)
  })
  it('accepts every whitelisted kind', () => {
    for (const kind of COMPONENT_KINDS) {
      expect('error' in (validateSpec({ ...valid, kind }) as any)).toBe(false)
    }
  })
})

describe('webhookBody', () => {
  const p = { event: 'cron:error', title: 'T', ok: false }
  it('formats WeCom bot payload', () => {
    const b = JSON.parse(webhookBody('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x', p))
    expect(b.msgtype).toBe('text')
    expect(b.text.content).toContain('cron:error')
    expect(b.text.content).toContain('失败')
  })
  it('formats Feishu bot payload', () => {
    const b = JSON.parse(webhookBody('https://open.feishu.cn/open-apis/bot/v2/hook/x', p))
    expect(b.msg_type).toBe('text')
    expect(b.content.text).toContain('cron:error')
  })
  it('falls through to raw payload for unknown hosts', () => {
    const b = JSON.parse(webhookBody('https://example.com/hook', p))
    expect(b.event).toBe('cron:error')
    expect(b.app).toBe('deskapp')
  })
  it('includes agent output when present', () => {
    const b = JSON.parse(webhookBody('https://open.feishu.cn/x', { ...p, output: 'AI泡沫降温，英伟达跌5%' }))
    expect(b.content.text).toContain('AI泡沫降温')
    expect(b.content.text).toContain('cron:error')
  })
})

describe('applyPatch', () => {
  const spec = { id: 'w1', title: 'T', kind: 'feed', cron: { schedule: '0 9 * * *', prompt: 'p {{topic}}' }, props: { topic: 'AI' } }
  it('replaces a nested value (live schedule edit)', () => {
    const r = applyPatch(spec, [{ op: 'replace', path: '/cron/schedule', value: '30 9 * * *' }]) as any
    expect(r.cron.schedule).toBe('30 9 * * *')
    expect(spec.cron.schedule).toBe('0 9 * * *')  // no mutation
  })
  it('adds and removes props keys', () => {
    const r = applyPatch(spec, [
      { op: 'add', path: '/props/webhook', value: 'https://open.feishu.cn/x' },
      { op: 'remove', path: '/props/topic' },
    ]) as any
    expect(r.props.webhook).toContain('feishu')
    expect('topic' in r.props).toBe(false)
  })
  it('rejects replace on missing path', () => {
    const r = applyPatch(spec, [{ op: 'replace', path: '/props/nope', value: 1 }]) as any
    expect(r.error).toMatch(/not found/)
  })
  it('rejects malformed ops', () => {
    expect('error' in (applyPatch(spec, []) as any)).toBe(true)
    expect('error' in (applyPatch(spec, [{ op: 'move', path: '/a' }]) as any)).toBe(true)
    expect('error' in (applyPatch(spec, [{ op: 'replace', path: 'noslash', value: 1 }]) as any)).toBe(true)
  })
})

describe('rectOverlapRatio (card drag-to-dock archive)', () => {
  const card = { x: 0, y: 0, width: 220, height: 264 }
  it('returns 0 for non-overlapping rects', () => {
    expect(rectOverlapRatio(card, { x: 500, y: 500, width: 100, height: 100 })).toBe(0)
  })
  it('returns 1 when fully contained', () => {
    expect(rectOverlapRatio(card, { x: -50, y: -50, width: 500, height: 500 })).toBe(1)
  })
  it('crosses the 0.5 archive threshold halfway in', () => {
    expect(rectOverlapRatio(card, { x: 110, y: 0, width: 340, height: 500 })).toBe(0.5)
    expect(rectOverlapRatio(card, { x: 109, y: 0, width: 340, height: 500 })).toBeGreaterThan(0.5)
  })
})
