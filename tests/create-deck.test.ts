import { describe, it, expect } from 'vitest'
import { buildReactDeck } from '../src/main/create-deck'

describe('buildReactDeck', () => {
  it('embeds the react-bits TextType component, slides and blocks', () => {
    const html = buildReactDeck('测试标题', [
      { kind: 'text', content: '第一段\n内容' },
      { kind: 'image', content: '/tmp/a.png' },
      { kind: 'table', content: '列A,列B\n1,2' },
      { kind: 'chart', content: 'bar\nX,5' },
    ])
    expect(html).toContain('TextType')
    expect(html).toContain('CircularText')
    expect(html).toContain('Shuffle')
    expect(html).toContain('AsciiRain')
    expect(html).toContain('::ascii::')
    expect(html).toContain('gsap.min.js')
    expect(html).toContain('framer-motion')
    expect(html).toContain('测试标题')
    expect(html).toContain('SLIDES=')
    // blocks landed in the slides JSON with tags escaped (script-injection safe)
    const m = html.match(/SLIDES=(\[.*\]);/)
    const slides = JSON.parse(m![1])
    expect(slides[1].body).toContain('第一段')
    expect(slides[2].src).toBe('file:///tmp/a.png')
    expect(slides[3].table).toContain('<table>')
    expect(slides[4].svg).toContain('<svg')
    expect(html).not.toContain('<table>')
  })
})
