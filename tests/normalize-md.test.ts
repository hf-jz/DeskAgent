import { describe, it, expect } from 'vitest'
import { normalizeMd } from '../src/shared/gen-ui-types'

describe('normalizeMd', () => {
  it('splits table rows glued onto one line', () => {
    const glued = '| # | 事件 | 热度 | | 1 | Meta 开源 | 1180 | | 2 | AI 网络 | 868 |'
    const out = normalizeMd(glued)
    expect(out).toContain('| 1 |')
    expect(out.match(/\n/g)?.length).toBeGreaterThanOrEqual(2)
  })
  it('turns bare QuickChart URLs into image syntax', () => {
    const out = normalizeMd('见 https://quickchart.io/chart?width=640&height=340&c=%7B%7D 图表')
    expect(out).toContain('![chart](https://quickchart.io/')
  })
})
