/**
 * Turn Context Builder — single injection chain for all agent context.
 *
 * Every segment that deskapp prepends to the user message flows through
 * `buildTurnContext()`.  P1-B3 items (#16 memory, #17 environment snapshot,
 * #19 skill catalog) land here; P2 items (#26 persona, #31 roots table)
 * extend the params and add their segments.
 *
 * The function is pure: input params → output string. It does no I/O itself.
 * Callers are responsible for gathering the data (memory recall, git status,
 * skill catalog, habit context, steering queue) and passing it in.
 */

import { execSync } from 'child_process'
import type { WorkspaceProfile, RepoStatus } from '../vfs'

// ── Params ──

export interface TurnContextParams {
  /** Raw user message (no prefix) */
  task: string
  /** Session identifier (for first-turn tracking) */
  sessionId: string
  /** Workspace directory path */
  workspace: string
  /** True if this is the first turn of the session (include environment snapshot) */
  isFirstTurn: boolean
  /** Mid-task messages from the steering queue (prepended before the task) */
  steeringMessages: string[]
  /** Habit context string from habit engine (may be empty) */
  habitCtx: string
}

// ── Segment builders ──

/** #17: Environment snapshot — injected on first turn only. */
function buildSnapshotBlock(workspace: string): string {
  const lines: string[] = []
  lines.push(`OS: ${process.platform} (${process.arch})`)
  lines.push(`时间: ${new Date().toISOString()}`)
  lines.push(`工作区: ${workspace}`)

  // Git context — best-effort, 1s timeout
  try {
    const branch = execSync('git branch --show-current', {
      cwd: workspace, timeout: 1000, encoding: 'utf-8',
    }).trim()
    if (branch) {
      lines.push(`Git 分支: ${branch}`)

      const status = execSync('git status --short', {
        cwd: workspace, timeout: 1000, encoding: 'utf-8',
      }).trim()
      if (status) {
        const statusLines = status.split('\n').slice(0, 20)
        lines.push(`Git 状态 (最多20条):\n${statusLines.map(l => `  ${l}`).join('\n')}`)
      }

      const log = execSync('git log --oneline -5', {
        cwd: workspace, timeout: 1000, encoding: 'utf-8',
      }).trim()
      if (log) {
        lines.push(`最近提交:\n${log.split('\n').map(l => `  ${l}`).join('\n')}`)
      }
    }
  } catch { /* not a git repo, or command timed out — skip gracefully */ }

  lines.push('⚠ 此快照可能过期，依赖其内容前请用工具重新验证')
  return lines.join('\n')
}

/**
 * Workspace profile block (see vfs.ts:WorkspaceProfile). Tells the agent what
 * this environment is FOR and which declared repos are actually on disk, so it
 * can set the rest up itself instead of guessing. Empty when no profile exists.
 */
export function buildProfileBlock(profile: WorkspaceProfile | null, repos: RepoStatus[]): string {
  if (!profile) return ''
  const lines: string[] = ['工作区用途:']
  if (profile.name) lines.push(`  名称: ${profile.name}`)
  if (profile.goal) lines.push(`  目标: ${profile.goal}`)
  if (repos.length) {
    lines.push('  期望仓库:')
    for (const r of repos) {
      lines.push(`    - ${r.dir} ${r.present ? '✓ 已存在' : '✗ 缺失'} (${r.repo}${r.branch ? ` @${r.branch}` : ''})`)
    }
    const missing = repos.filter((r) => !r.present)
    if (missing.length) {
      lines.push(`  缺失的仓库需要先准备好再开始工作（克隆/同步由你执行，工作区就是 cwd）`)
    }
  }
  return lines.join('\n')
}

/** #19: Skill catalog — name + one-line description only, not full SKILL.md. */
function buildCatalogBlock(catalog: { name: string; description: string }[]): string {
  if (catalog.length === 0) return ''
  const lines: string[] = []
  for (const s of catalog) {
    lines.push(`- ${s.name}: ${s.description}`)
  }
  lines.push('(需要时用 skill_view 加载全文)')
  return lines.join('\n')
}

/** #16: Memory entries formatted as [#id] value. */
function buildMemoryBlock(memoryText: string): string {
  if (!memoryText) return ''
  return memoryText
}

// ── Main builder ──

export interface ContextSegments {
  /** #17: Environment snapshot text (empty if not first turn) */
  snapshot: string
  /** #19: Skill catalog text */
  catalog: string
  /** #16: Memory entries in [#id] format */
  memory: string
}

export function buildTurnContext(
  params: TurnContextParams,
  segments: ContextSegments,
): string {
  const blocks: string[] = []

  // 1. Environment snapshot — first turn only
  if (params.isFirstTurn && segments.snapshot) {
    blocks.push(`[环境快照]\n${segments.snapshot}`)
  }

  // 2. Skill catalog — every turn (lightweight)
  if (segments.catalog) {
    blocks.push(`[可用技能]\n${segments.catalog}`)
  }

  // 3. Memory recall — every turn
  if (segments.memory) {
    blocks.push(`[记忆 — 仅供参考，可经 memory 工具更新]\n${segments.memory}`)
  }

  // 4. Habit context — when relevant
  if (params.habitCtx) {
    blocks.push(`[用户习惯上下文 — 仅供参考，不要向用户复述]\n${params.habitCtx}`)
  }

  // #26: active persona prefix (global, set in AgentsTab)
  try {
    const prefix = require('../personas').getActivePersonaPrefix()
    if (prefix) blocks.push(`[人格设定]\n${prefix}`)
  } catch { /* personas store not ready */ }

  // i18n: 回复语言跟随界面语言（Settings > General）
  try {
    const lang = require('../settings-store').loadSettings().language === 'en' ? 'English' : '中文'
    blocks.push(`[语言要求] 请始终用${lang}回复用户（含总结与所有面向用户的文本）。`)
  } catch { /* settings not ready */ }

  // #13: file-reference convention so artifact chips render in the bubble
  blocks.push('[文件引用约定] 引用工作区文件时使用 [文件名](file:文件名) 链接格式')
  // Create-intent rule: when the user asks to MAKE content (PPT/展示/手册/宣传页),
  // the FIRST line of the reply must be the machine-readable intent, then continue.
  blocks.push('[创作任务规则] 当用户要求制作/生成内容（PPT、展示、手册、画册、宣传页等，常含"根据XX文件夹"）时，' +
    '回复的第一行必须是 CREATE_INTENT: {"type":"presentation|document","source":"素材文件夹绝对路径(解析用户描述)","title":"标题"}，' +
    '然后正常执行创作任务；非创作任务不要输出这一行。')
  // #31: visible roots so the agent knows where files may live
  try {
    const { listRoots } = require('../vfs')
    const roots = listRoots().filter(Boolean)
    if (roots.length > 1) blocks.push(`[可见目录]\n${roots.map((r: string, i: number) => `${i === 0 ? '工作区（可写）' : '附加（只读）'}: ${r}`).join('\n')}`)
  } catch { /* vfs not ready */ }

  // img2threejs: photo → procedural Three.js (forge pipeline).
  // The agent drives the zero-dependency forge state machine via terminal:
  //   python3 ~/web/img2threejs/forge/state.py init --reference <img> --profile generic
  //   python3 ~/web/img2threejs/forge/next.py --state .img2threejs/state.json
  //   python3 ~/web/img2threejs/forge/state.py mark <step> --state .img2threejs/state.json
  // (run in a project dir under ~/3d-projects/<name>/); the console window
  // shows the same state machine. When the user asks to turn an image into
  // a 3D model (img2threejs/3D 建模/把图做成 3D/模型重建), reply's FIRST line:
  //   IMG2THREEJS_INTENT: {"reference":"图片绝对路径","projectName":"项目名","profile":"generic|character|cs2"}
  // then drive the forge pipeline via terminal and open the console.
  blocks.push('[3D 建模规则] 当用户要求把图片做成 3D 模型（img2threejs、3D 建模、把图做成 3D、模型重建、procedural three.js）时，' +
    '回复的第一行必须是 IMG2THREEJS_INTENT: {"reference":"参考图绝对路径(解析用户给出的图片)","projectName":"英文项目名","profile":"generic"}，' +
    '然后用 terminal 运行 ~/web/img2threejs/forge 的 state.py init / next.py / state.py mark 驱动流水线（9 道质量门禁），' +
    '完成后说明产物位置；非 3D 请求不要输出这一行。')

  // 5. Steering messages — when present
  if (params.steeringMessages.length > 0) {
    const prefix = '以下是在执行上一任务期间用户补充的消息：'
    blocks.push(`[补充消息]\n${prefix}\n${params.steeringMessages.join('\n')}`)
  }

  // 6. 今日日程/项目/任务摘要（Scheduler）— 早晨问答可直接引用
  try {
    const { todaySummary } = require('../scheduler')
    const td = todaySummary()
    const lines: string[] = []
    lines.push(`今日日期: ${td.date}`)
    const _now = new Date()
    const _h = _now.getHours()
    const _g = _h < 6 ? '夜深了' : _h < 9 ? '早上好' : _h < 12 ? '上午好' : _h < 14 ? '中午好' : _h < 18 ? '下午好' : _h < 22 ? '晚上好' : '夜深了'
    lines.push(`当前时间: ${_h}:${String(_now.getMinutes()).padStart(2, '0')}（本次问候语用：${_g}）`)
    if (td.events.length > 0) {
      lines.push('今日日程: ' + td.events.map((e: any) => `${e.startHour}:00-${e.endHour}:00 ${e.title}${e.room ? `(${e.room})` : ''}`).join('; '))
    }
    if (td.projects.length > 0 || td.tasks.length > 0) {
      lines.push('进行中项目: ' + td.projects.map((p: any) => `${p.name}(${p.health || 0}健康度)`).join('; ') || '无')
      const running = td.tasks.filter((x: any) => x.status === '进行中' || x.status === '阻塞')
      if (running.length > 0) lines.push('进行中/阻塞任务: ' + running.map((x: any) => `${x.title}[${x.status}]`).join('; '))
    }
    if (td.crons.length > 0) {
      lines.push('今日定时任务: ' + td.crons.map((j: any) => `${j.name}(${j.schedule})`).join('; '))
    }
    if (lines.length > 1) blocks.push(`[今日日程与任务状态]\n${lines.join('\n')}`)
  } catch { /* scheduler store unavailable */ }

  // Build the final prompt: blocks, then user message
  const prefix = blocks.length > 0 ? blocks.join('\n\n') + '\n\n' : ''
  return prefix + `用户消息：${params.task}`
}

// ── Convenience: build snapshot without full context (for ipc-handlers) ──

export function buildSnapshot(workspace: string): string {
  return buildSnapshotBlock(workspace)
}

// ── Convenience: build catalog from skill-hub entries ──

export function buildCatalog(skills: { name: string; description: string }[]): string {
  return buildCatalogBlock(skills)
}
