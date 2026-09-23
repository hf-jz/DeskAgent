import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// feed.ts 主链路：真实 fs + 真实 statText/目录树，只 mock 掉窗口层
const sendSpies: { send: ReturnType<typeof vi.fn> }[] = []
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { send: vi.fn() }
    isDestroyed = () => false
    getBounds = () => ({ x: 10, y: 20, width: 220, height: 212 })
  },
  screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}))
vi.mock('../src/main/task-bubble', () => ({
  createNewBubble: vi.fn((_preload: string, _bounds: unknown) => {
    const wc = { send: vi.fn(), isLoading: () => false }
    sendSpies.push(wc)
    return { webContents: wc, isDestroyed: () => false }
  }),
}))
vi.mock('../src/main/pet-window', () => ({ stopPetWalk: vi.fn() }))

import { feedFiles } from '../src/main/feed'
import { createNewBubble } from '../src/main/task-bubble'
import type { FeedPayload } from '../src/shared/ipc-channels'

function makePetWin() {
  return {
    isDestroyed: () => false,
    getBounds: () => ({ x: 10, y: 20, width: 220, height: 212 }),
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feed-int-'))
  writeFileSync(join(dir, 'plan.md'), '# 计划\n\n两步走。')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'logo.png'), 'PNG-BINARY')
  sendSpies.length = 0
  vi.clearAllMocks()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('feedFiles — 投喂主链路', () => {
  it('单 md 文件：宠物播报咀嚼文案，气泡收到分析任务', () => {
    const pet = makePetWin()
    feedFiles([join(dir, 'plan.md')], pet, '/preload.js')

    const say = (pet.webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'pet:say')
    expect(say).toBeTruthy()
    expect(say![1]).toBe('嗷呜～嚼嚼嚼… plan.md 真香！')

    expect(createNewBubble).toHaveBeenCalledWith('/preload.js', { x: 10, y: 20, width: 220, height: 212 })
    const [chan, payload] = sendSpies[0].send.mock.calls[0] as [string, FeedPayload]
    expect(chan).toBe('feed:analyze')
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].kind).toBe('file')
    expect(payload.items[0].preview).toContain('# 计划')
    expect(payload.summary).toContain('plan.md')
    expect(payload.summary).toContain('# 计划')
  })

  it('单文件夹：目录树进 summary，预览含子目录', () => {
    const pet = makePetWin()
    feedFiles([dir], pet, '/preload.js')

    const say = (pet.webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'pet:say')
    expect(say![1]).toContain('文件夹')
    const [chan, payload] = sendSpies[0].send.mock.calls[0] as [string, FeedPayload]
    expect(chan).toBe('feed:analyze')
    const item = payload.items[0]
    expect(item.kind).toBe('folder')
    expect(item.preview).toContain('assets/')
    expect(item.preview).toContain('plan.md')
    // 二进制文件只列名不读内容
    expect(item.preview).toContain('logo.png')
    expect(item.preview).not.toContain('PNG-BINARY')
  })

  it('多文件混合：数量文案', () => {
    writeFileSync(join(dir, 'note.txt'), 'x')
    const pet = makePetWin()
    feedFiles([join(dir, 'plan.md'), join(dir, 'note.txt'), dir], pet, '/p.js')
    const say = (pet.webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'pet:say')
    expect(say![1]).toBe('吧唧吧唧… 2个文件+1个文件夹 吃光光～')
  })

  it('路径不存在：错误文案，不开气泡', () => {
    const pet = makePetWin()
    feedFiles([join(dir, 'ghost.md')], pet, '/p.js')
    const say = (pet.webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'pet:say')
    expect(say![1]).toBe('呜呜…这个我咬不动啦')
    expect(createNewBubble).not.toHaveBeenCalled()
  })

  it('部分失败：成功项照常分析（剩 1 项 → 单数文案）', () => {
    const pet = makePetWin()
    feedFiles([join(dir, 'plan.md'), join(dir, 'ghost.md')], pet, '/p.js')
    const say = (pet.webContents.send as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === 'pet:say')
    expect(say![1]).toBe('嗷呜～嚼嚼嚼… plan.md 真香！')
    expect(sendSpies[0].send.mock.calls[0][1].items).toHaveLength(1)
  })
})
