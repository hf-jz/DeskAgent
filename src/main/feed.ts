/**
 * FeedService — 桌面宠物「投喂」入口。
 *
 * Finder 拖文件/文件夹到宠物 → hit 窗口 drop → IPC pet:feed [paths]
 * → 本模块：
 *   1. fs.stat 分类（文件/文件夹、扩展名、大小、mtime）
 *   2. 组装 S2 咀嚼文案，push pet:say 让宠物播报
 *   3. 内容提取（文本预览 / 目录树，限大小限深度）
 *   4. createNewBubble 打开新气泡窗口 → push feed:analyze
 *
 * PDF 文本提取走气泡内既有 #11 管道（BubbleApp vfsImport + extractPdf），
 * 本模块不碰 PDF（方案 §5.6）。
 */
import { BrowserWindow } from 'electron'
import { statSync, readdirSync, readFileSync } from 'fs'
import { basename, extname, join } from 'path'
import type { FeedItem, FeedPayload } from '../shared/ipc-channels'
import { createNewBubble } from './task-bubble'
import { stopPetWalk } from './pet-window'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'

function lang(): Lang {
  return loadSettings().language === 'en' ? 'en' : 'zh'
}

const PREVIEW_MAX_BYTES = 256 * 1024
const TREE_MAX_DEPTH = 3
const TREE_MAX_ENTRIES = 100
const SUMMARY_MAX_CHARS = 64 * 1024

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java', '.kt', '.swift',
  '.yml', '.yaml', '.toml', '.xml', '.html', '.css', '.scss', '.sh', '.log',
  '.ini', '.conf', '.sql', '.svg', '.env',
])

/** 目录树展开时跳过的重型/生成目录（防目录爆炸） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.next', '__pycache__', '.venv', 'venv', 'Pods', 'DerivedData'])

function fmtSize(n: number): string {
  if (n > 1048576) return (n / 1048576).toFixed(1) + 'MB'
  if (n > 1024) return Math.round(n / 1024) + 'KB'
  return n + 'B'
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 目录树文本（深度≤3、每层≤100 项、过滤隐藏文件） */
export function buildTree(dir: string, depth: number): string[] {
  if (depth > TREE_MAX_DEPTH) return ['  '.repeat(depth) + '…']
  let entries: string[] = []
  try {
    entries = readdirSync(dir).filter(n => !n.startsWith('.'))
  } catch { return [] }
  const dirs = entries.filter(n => {
    try { return statSync(join(dir, n)).isDirectory() } catch { return false }
  })
  const files = entries.filter(n => !dirs.includes(n))
  const out: string[] = []
  for (const n of [...dirs, ...files].slice(0, TREE_MAX_ENTRIES)) {
    const p = join(dir, n)
    const pad = '  '.repeat(depth)
    if (dirs.includes(n)) {
      if (SKIP_DIRS.has(n)) { out.push(pad + n + '/' + translate(lang(), 'feed.skipped')); continue }
      out.push(pad + n + '/')
      out.push(...buildTree(p, depth + 1))
    } else {
      out.push(pad + n)
    }
  }
  if (entries.length > TREE_MAX_ENTRIES) {
    out.push('  '.repeat(depth) + translate(lang(), 'feed.more', { n: entries.length - TREE_MAX_ENTRIES }))
  }
  return out
}

/** 文本文件预览（前 256KB，超限截断）；二进制返回 '' */
function readPreview(filePath: string, ext: string): string {
  if (!TEXT_EXTS.has(ext)) return ''
  try {
    const buf = readFileSync(filePath)
    if (buf.length === 0) return ''
    const slice = buf.length > PREVIEW_MAX_BYTES ? buf.subarray(0, PREVIEW_MAX_BYTES) : buf
    // 非 UTF-8 文本（如二进制伪装成 .txt）会解出乱码 —— 交给 agent 用工具复核，不在此判定
    return slice.toString('utf-8') + (buf.length > PREVIEW_MAX_BYTES ? '\n' + translate(lang(), 'feed.truncated') : '')
  } catch { return '' }
}

/** S2 咀嚼文案 */
export function buildStatText(items: FeedItem[]): string {
  const L = lang()
  if (items.length === 1) {
    const it = items[0]
    const label = it.kind === 'folder' ? it.name + translate(L, 'common.folder') : it.name
    return translate(L, 'feed.eatFile', { name: truncate(label, 30) })
  }
  const files = items.filter(i => i.kind === 'file').length
  const folders = items.filter(i => i.kind === 'folder').length
  const parts: string[] = []
  if (files > 0) parts.push(translate(L, 'feed.files', { n: files }))
  if (folders > 0) parts.push(translate(L, 'feed.folders', { n: folders }))
  return translate(L, 'feed.eatMany', { count: parts.join('+') })
}

function buildSummary(items: FeedItem[]): string {
  const blocks: string[] = []
  for (const it of items) {
    const head = `${it.kind === 'folder' ? '📁' : '📄'} ${it.name}（${it.path}，${fmtSize(it.size)}，${new Date(it.modifiedAt).toLocaleString('zh-CN')}）`
    blocks.push(it.preview ? head + '\n' + it.preview : head)
  }
  const full = blocks.join('\n\n')
  return full.length > SUMMARY_MAX_CHARS
    ? full.slice(0, SUMMARY_MAX_CHARS) + '\n' + translate(lang(), 'feed.summaryTrunc')
    : full
}

/**
 * 构建 FeedPayload（纯数据：stat 分类 + 文本预览 + 目录树 + summary）。
 * 不播报、不开窗 —— feedFiles 与气泡内清单编辑（feed:build）共用。
 */
export function buildFeedPayload(paths: string[]): FeedPayload {
  const items: FeedItem[] = []
  for (const p of paths) {
    try {
      const st = statSync(p)
      const isDir = st.isDirectory()
      const name = basename(p)
      items.push({
        path: p,
        name,
        kind: isDir ? 'folder' : 'file',
        size: st.size,
        ext: isDir ? '' : extname(name).toLowerCase(),
        modifiedAt: st.mtimeMs,
        preview: isDir ? buildTree(p, 0).join('\n') : readPreview(p, extname(name).toLowerCase()),
      })
    } catch {
      // stat 失败（文件被移走/无权限）—— 跳过，全失败则走错误播报
    }
  }
  return {
    items,
    summary: buildSummary(items),
    statText: items.length > 0 ? buildStatText(items) : '',
    petBounds: { x: 0, y: 0, width: 0, height: 0 },
  }
}

/**
 * 文件夹拆一层：返回一级子项（文件+子文件夹，过滤隐藏），不含 preview。
 * 气泡清单"展开"用；后续由 buildFeedPayload 全量刷新 preview。
 */
export function expandFolder(folderPath: string): FeedItem[] {
  let entries: string[] = []
  try {
    entries = readdirSync(folderPath).filter(n => !n.startsWith('.'))
  } catch { return [] }
  const out: FeedItem[] = []
  for (const n of entries.slice(0, 500)) {
    const p = join(folderPath, n)
    try {
      const st = statSync(p)
      const isDir = st.isDirectory()
      out.push({
        path: p,
        name: n,
        kind: isDir ? 'folder' : 'file',
        size: st.size,
        ext: isDir ? '' : extname(n).toLowerCase(),
        modifiedAt: st.mtimeMs,
        preview: '',
      })
    } catch { /* 单个条目失效跳过 */ }
  }
  return out
}

/**
 * 处理一次投喂：分类 → 播报 → 提取 → 开气泡窗口 → 推送分析任务。
 * 全程同步快路径（stat/readFile 本地 IO），不引入异步队列。
 */
export function feedFiles(paths: string[], petWin: BrowserWindow | null, preloadPath: string): void {
  // drop 瞬间若宠物正在散步，先站定 —— hit 窗口随宠物滑动会让拖拽抖动
  stopPetWalk()

  const petSay = (text: string, ms: number): void => {
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:say', text, ms)
  }

  const payload = buildFeedPayload(paths)
  if (payload.items.length === 0) { petSay(translate(lang(), 'feed.error'), 3000); return }

  petSay(payload.statText, 3000)

  const feedPayload: FeedPayload = {
    ...payload,
    petBounds: petWin && !petWin.isDestroyed() ? petWin.getBounds() : { x: 0, y: 0, width: 0, height: 0 },
  }

  const win = createNewBubble(preloadPath, feedPayload.petBounds)
  // createNewBubble 后立即 send 会在渲染进程 preload 注册监听前丢失 ——
  // 等页面加载完成（preload 已挂 listener）再推送
  const sendAnalyze = (): void => {
    if (!win.isDestroyed()) win.webContents.send('feed:analyze', feedPayload)
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', sendAnalyze)
  else sendAnalyze()
}
