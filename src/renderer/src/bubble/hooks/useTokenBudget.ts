/**
 * Token pricing and budget utilities for the bubble chat.
 */

const CONTEXT_WARN_THRESHOLD = 150_000
const CONTEXT_MAX = 200_000

// ¥ per 1M tokens, by model. ⚠️ 占位价格 — 需按各平台官方价目校准。
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'kimi-k3':           { prompt: 30,  completion: 60  },  // frontier planner (placeholder)
  'deepseek-v4-pro':   { prompt: 4,   completion: 16  },  // worker (placeholder)
  'deepseek-v4-flash': { prompt: 1,   completion: 4   },  // cheap tier (placeholder)
}
const DEFAULT_PRICING = { prompt: 4, completion: 16 }

export interface TokenInfo {
  total: number
  prompt: number
  completion: number
}

/** Calculate cost in ¥ for a given token usage, using the model's price tier */
export function calcTurnCost(tokens: TokenInfo, model?: string): number {
  const p = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
  return (tokens.prompt * p.prompt + tokens.completion * p.completion) / 1_000_000
}

/** Format cost for display */
export function formatCost(cost: number): string {
  return `¥${cost.toFixed(4)}`
}

/** Format token count */
export function formatTokens(n: number): string {
  return n.toLocaleString()
}

/** Check if cumulative cost exceeds daily budget */
export function isOverBudget(cumulativeCost: number, dailyBudget: number): boolean {
  return dailyBudget > 0 && cumulativeCost >= dailyBudget
}

/** Check if approaching budget limit (80%) */
export function isNearBudget(cumulativeCost: number, dailyBudget: number): boolean {
  return dailyBudget > 0 && cumulativeCost >= dailyBudget * 0.8
}

/** Check if context is getting large */
export function isContextWarning(totalTokens: number): boolean {
  return totalTokens > CONTEXT_WARN_THRESHOLD
}

/** Get context bar percentage */
export function contextBarPercent(totalTokens: number): number {
  return Math.min(100, (totalTokens / CONTEXT_MAX) * 100)
}

// ── Risk detection (structured) ──

export type RiskCategory = 'destructive_delete' | 'system_modify' | 'permission_change' | 'bulk_write' | 'sensitive_access'

export interface RiskItem {
  category: RiskCategory
  /** The substring in the user input that triggered this risk. */
  snippet: string
  /** Human-readable explanation in Chinese. */
  description: string
  /** Severity: 1=caution, 2=warning, 3=danger. */
  severity: 1 | 2 | 3
}

interface RiskRule {
  pattern: RegExp
  category: RiskCategory
  descriptionTemplate: string
  severity: 1 | 2 | 3
}

const RISK_RULES: RiskRule[] = [
  // ── Destructive delete ──
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*)\b/i,          category: 'destructive_delete', severity: 3, descriptionTemplate: '递归/强制删除命令' },
  { pattern: /\bsudo\s+rm\b/i,                                                     category: 'destructive_delete', severity: 3, descriptionTemplate: 'sudo 提权删除' },
  { pattern: /\bdelete\s+all\b/i,                                                  category: 'destructive_delete', severity: 3, descriptionTemplate: '批量删除所有文件' },
  { pattern: /删除所有|删掉所有|全部删[除掉]/i,                                      category: 'destructive_delete', severity: 3, descriptionTemplate: '批量删除所有文件' },
  { pattern: /\b格式化\b|\bformat\s+(disk|drive|volume|\/dev)/i,                   category: 'destructive_delete', severity: 3, descriptionTemplate: '格式化磁盘/分区' },

  // ── System modification ──
  { pattern: /\b(mkfs\.|fdisk|dd\s+if=)/i,                                        category: 'system_modify', severity: 3, descriptionTemplate: '底层磁盘/文件系统操作' },
  { pattern: /\b>\/dev\/[a-z]+\b/i,                                                category: 'system_modify', severity: 3, descriptionTemplate: '写入设备文件（可能损坏磁盘）' },
  { pattern: /\bsystemctl\s+(disable|mask|stop)\s+(sshd|network|firewall)/i,      category: 'system_modify', severity: 3, descriptionTemplate: '禁用系统关键服务' },
  { pattern: /\biptables\s+-[AF]\b/i,                                              category: 'system_modify', severity: 2, descriptionTemplate: '修改防火墙规则' },
  { pattern: /清理系统|清除缓存|清[理空]所有\s*(文件|数据)/i,                         category: 'system_modify', severity: 2, descriptionTemplate: '批量清理系统文件' },

  // ── Permission change ──
  { pattern: /\bchmod\s+(-R\s+)?777\b/i,                                          category: 'permission_change', severity: 3, descriptionTemplate: '开放所有用户完全读写执行权限' },
  { pattern: /\bchown\s+(-R\s+)?[^:]+:[^:]+\s+\/\b/i,                             category: 'permission_change', severity: 3, descriptionTemplate: '递归修改根目录文件所有者' },
  { pattern: /\bsudo\s+(su|bash|sh)\b/i,                                           category: 'permission_change', severity: 2, descriptionTemplate: '提权到 root shell' },

  // ── Bulk write / file overwrite ──
  { pattern: /覆盖\s*(所有|全部)|批量\s*(写[入入]|修改|替换)/i,                     category: 'bulk_write', severity: 2, descriptionTemplate: '批量覆盖/修改文件' },
  { pattern: /\b(rewrite|overwrite)\s+(all|every)\b/i,                            category: 'bulk_write', severity: 2, descriptionTemplate: '覆盖所有文件' },

  // ── Sensitive access ──
  { pattern: /\b(cat|read|tail)\s+\/(etc\/(shadow|passwd|sudoers)|proc\/[0-9]+)/i, category: 'sensitive_access', severity: 2, descriptionTemplate: '读取系统敏感文件' },
  { pattern: /\b(curl|wget)\s+.*\|\s*(bash|sh|zsh)\b/i,                           category: 'system_modify', severity: 3, descriptionTemplate: '从网络下载并直接执行脚本（pipe-to-shell）' },

  // ── Fork bomb / resource exhaustion ──
  { pattern: /:\(\)\s*\{|fork\s*bomb/i,                                           category: 'system_modify', severity: 3, descriptionTemplate: 'Fork 炸弹 / 资源耗尽攻击' },
]

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  destructive_delete: '破坏性删除',
  system_modify: '系统级修改',
  permission_change: '权限变更',
  bulk_write: '批量写入',
  sensitive_access: '敏感文件访问',
}

/** Analyze user input and return a list of detected risks. Returns [] if safe. */
export function analyzeRisks(text: string): RiskItem[] {
  const results: RiskItem[] = []
  for (const rule of RISK_RULES) {
    const m = rule.pattern.exec(text)
    if (m) {
      results.push({
        category: rule.category,
        snippet: m[0],
        description: rule.descriptionTemplate,
        severity: rule.severity,
      })
    }
  }
  return results
}

/** Quick boolean check (backward-compatible alias). */
export function isDangerousCommand(text: string): boolean {
  return analyzeRisks(text).length > 0
}

/** Get Chinese label for a risk category. */
export function riskCategoryLabel(c: RiskCategory): string {
  return CATEGORY_LABELS[c] || c
}

/** Get severity color hex. */
export function riskSeverityColor(s: 1 | 2 | 3): string {
  return s === 3 ? '#EF4444' : s === 2 ? '#F59E0B' : '#FBBF24'
}

/** Smart agent routing based on task keywords */
export function suggestAgent(
  text: string,
  currentAgent: string,
  availableAgents: { id: string; name: string }[],
): string | null {
  const lower = text.toLowerCase()
  const hasClaude = availableAgents.find(a => a.id === 'claude-code')

  if ((/\b(code|debug|fix|refactor|写代码|bug|修复|重构|test|测试)\b/i.test(text)) && hasClaude) {
    if (currentAgent !== 'claude-code') return 'claude-code'
  }
  return null
}
