import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// feed.ts 依赖 electron（BrowserWindow/createNewBubble）—— 纯函数测试只需 mock 掉
vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}))

import { buildStatText, buildTree, buildFeedPayload, expandFolder } from '../src/main/feed'
import type { FeedItem } from '../src/shared/ipc-channels'

const item = (name: string, kind: 'file' | 'folder'): FeedItem => ({
  path: '/x/' + name, name, kind, size: 10, ext: kind === 'file' ? '.md' : '', modifiedAt: 0, preview: '',
})

describe('buildStatText — S2 咀嚼文案', () => {
  it('单文件：名称+扩展名', () => {
    expect(buildStatText([item('plan.md', 'file')])).toBe('嗷呜～嚼嚼嚼… plan.md 真香！')
  })
  it('单文件夹：名称+文件夹', () => {
    expect(buildStatText([item('docs', 'folder')])).toBe('嗷呜～嚼嚼嚼… docs文件夹 真香！')
  })
  it('多对象：数量统计', () => {
    expect(buildStatText([item('a.md', 'file'), item('b.txt', 'file'), item('d', 'folder')]))
      .toBe('吧唧吧唧… 2个文件+1个文件夹 吃光光～')
  })
  it('长名截断', () => {
    expect(buildStatText([item('x'.repeat(40) + '.md', 'file')])).toBe('嗷呜～嚼嚼嚼… ' + 'x'.repeat(30) + '… 真香！')
  })
})

describe('buildTree — 目录树', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feed-test-'))
    writeFileSync(join(dir, 'a.md'), 'hi')
    writeFileSync(join(dir, '.hidden'), 'x')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'c.txt'), 'x')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'pkg.js'), 'x')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('过滤隐藏文件、跳过 node_modules、展开子目录', () => {
    const tree = buildTree(dir, 0).join('\n')
    expect(tree).toContain('a.md')
    expect(tree).toContain('sub/')
    expect(tree).toContain('c.txt')
    expect(tree).not.toContain('.hidden')
    expect(tree).toContain('node_modules/ (跳过)')
    expect(tree).not.toContain('pkg.js')
  })

  it('深度截断', () => {
    const deep = buildTree(dir, 4)
    expect(deep[deep.length - 1]).toBe('        …')
  })
})

describe('buildFeedPayload — 清单重建（feed:build）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feed-build-'))
    writeFileSync(join(dir, 'a.md'), '# A')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.txt'), 'B')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('混合路径集：分类正确、预览进 summary、statText 生成', () => {
    const p = buildFeedPayload([join(dir, 'a.md'), join(dir, 'sub')])
    expect(p.items).toHaveLength(2)
    expect(p.items[0].kind).toBe('file')
    expect(p.items[1].kind).toBe('folder')
    expect(p.summary).toContain('# A')
    expect(p.summary).toContain('b.txt')
    expect(p.statText).toBe('吧唧吧唧… 1个文件+1个文件夹 吃光光～')
  })

  it('全部失效：items 空 + statText 空（调用方负责错误播报）', () => {
    const p = buildFeedPayload([join(dir, 'ghost.md')])
    expect(p.items).toHaveLength(0)
    expect(p.statText).toBe('')
  })
})

describe('expandFolder — 文件夹拆一层（feed:expand）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feed-exp-'))
    writeFileSync(join(dir, 'a.md'), 'x')
    writeFileSync(join(dir, '.hidden'), 'x')
    mkdirSync(join(dir, 'sub'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('一层子项：文件+子文件夹，过滤隐藏', () => {
    const kids = expandFolder(dir)
    const names = kids.map(k => k.name)
    expect(names).toContain('a.md')
    expect(names).toContain('sub')
    expect(names).not.toContain('.hidden')
    expect(kids.find(k => k.name === 'sub')!.kind).toBe('folder')
    expect(kids.find(k => k.name === 'a.md')!.kind).toBe('file')
  })

  it('路径不存在：空数组', () => {
    expect(expandFolder(join(dir, 'nope'))).toEqual([])
  })
})
