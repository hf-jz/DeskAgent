/**
 * 影子自动化引擎 — 工作流重复检测 + skill/cron 提案
 *
 * Phase 4: 统计手动重复工作流 → 提议自动化。
 * 设计文档 §7.1：出现 ≥5 次 → 宠物主动提议生成 skill/cron。
 */
import type { ActivitySegment, HabitCard } from './types'
import { getSegmentsForDate, insertHabit, getAllHabits, insertSuggestion } from './store'
import { localDateStr } from './util'

/** 工作流片段：一系列连续操作 */
interface WorkflowPattern {
  /** 去重后的 app 序列 */
  apps: string[]
  /** 出现次数 */
  count: number
  /** 出现的日期 */
  days: Set<string>
  /** 示例时间线 */
  sampleSegments: ActivitySegment[]
}

/**
 * 从活动段中检测重复工作流。
 * 扫描最近 14 天的 segments，找到 ≥5 次重复的 app 序列。
 */
export function detectWorkflows(): HabitCard[] {
  const now = new Date()
  const allSegments: { date: string; segments: ActivitySegment[] }[] = []

  for (let i = 0; i < 14; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = localDateStr(d) // C14: 本地时区
    const segs = getSegmentsForDate(dateStr)
    if (segs.length > 0) allSegments.push({ date: dateStr, segments: segs })
  }

  // 提取每天的 app 去重序列
  const dailySequences = allSegments.map(({ date, segments }) => {
    const apps: string[] = []
    for (const s of segments) {
      if (apps[apps.length - 1] !== s.app) apps.push(s.app)
    }
    return { date, apps }
  })

  // 用滑动窗口找重复的子序列（长度 2-5）
  const patterns = new Map<string, WorkflowPattern>()

  for (const { date, apps } of dailySequences) {
    for (let len = 2; len <= 5; len++) {
      for (let i = 0; i <= apps.length - len; i++) {
        const slice = apps.slice(i, i + len)
        const key = slice.join('|')
        const existing = patterns.get(key)
        if (existing) {
          existing.count++
          existing.days.add(date)
        } else {
          patterns.set(key, {
            apps: slice,
            count: 1,
            days: new Set([date]),
            sampleSegments: [],
          })
        }
      }
    }
  }

  // 过滤：≥5 次，≥3 天
  const existing = getAllHabits()
  const newWorkflows: HabitCard[] = []

  for (const [, p] of Array.from(patterns)) {
    if (p.count < 5 || p.days.size < 3) continue

    const name = p.apps.join(' → ')
    if (existing.find(h => h.name === name)) continue

    const card: HabitCard = {
      name,
      kind: 'workflow',
      triggerJson: JSON.stringify({ apps: p.apps }),
      patternJson: JSON.stringify({
        sequence: p.apps,
        daily_count: Math.round(p.count / p.days.size),
      }),
      confidence: Math.min(0.8, 0.4 + p.days.size * 0.08),
      evidenceCount: p.count,
      firstSeen: localDateStr(),
      lastSeen: localDateStr(),
      status: 'candidate',
      userNote: '',
    }
    insertHabit(card)
    newWorkflows.push(card)
  }

  return newWorkflows
}

/**
 * 为检测到的工作流生成自动化提案。
 * 放在 suggestions 表中，状态 pending，等待用户确认。
 */
export interface AutomationProposal {
  habitId: number | null
  workflowName: string
  description: string
  /** 建议的 skill 名称（如果用户确认，planner 会生成对应 skill） */
  suggestedSkillName: string
}

export function generateAutomationProposals(workflows: HabitCard[]): AutomationProposal[] {
  const proposals: AutomationProposal[] = []

  for (const w of workflows) {
    let apps: string[] = []
    try { apps = JSON.parse(w.patternJson).sequence || [] } catch { /* */ }

    if (apps.length < 2) continue

    const skillName = apps
      .map(a => a.replace(/\s+/g, '-').toLowerCase())
      .join('-')
      .slice(0, 40)

    const description = `你在 ${w.evidenceCount} 次中重复了这个流程：${apps.join(' → ')}。要我把它变成一键技能吗？确认后我会生成一个 skill，下次说"${w.name}"就能自动执行。`

    const proposal: AutomationProposal = {
      habitId: w.id || null,
      workflowName: w.name,
      description,
      suggestedSkillName: skillName,
    }

    // 存入 suggestions 表
    insertSuggestion({
      habitId: w.id || null,
      kind: 'automation',
      payload: JSON.stringify({
        workflow: w.name,
        apps,
        suggestedSkillName: skillName,
        summary: description,
      }),
      status: 'pending',
    })

    proposals.push(proposal)
  }

  return proposals
}

/**
 * 主入口：检测工作流 + 生成提案。
 * 建议每周运行一次（周日固化时调用）。
 */
export function runShadowAutomation(): {
  workflows: HabitCard[]
  proposals: AutomationProposal[]
} {
  const workflows = detectWorkflows()
  const proposals = generateAutomationProposals(workflows)
  return { workflows, proposals }
}
