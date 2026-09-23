// ── Tool Risk Classification (P0-3) ──
//
// Based on openworker's risk.py + overrides.py:
//   - Four risk levels: read / write-low / write-high / destructive
//   - Built-in classification table by tool name and argument patterns
//   - User glob overrides with specificity-based tie-breaking
//   - Injected into AgentEvent payloads via event-bus

export type RiskClass = 'read' | 'write-low' | 'write-high' | 'destructive'

// ── Built-in classification table ──

interface RiskRule {
  tool: string
  risk: RiskClass
  argPattern?: RegExp
  argDescription?: string
}

const BUILTIN_RULES: RiskRule[] = [
  // ── Read-only tools ──
  { tool: 'read_file', risk: 'read' },
  { tool: 'search_files', risk: 'read' },
  { tool: 'search_file', risk: 'read' },
  { tool: 'grep', risk: 'read' },
  { tool: 'rg', risk: 'read' },
  { tool: 'ls', risk: 'read' },
  { tool: 'cat', risk: 'read' },
  { tool: 'head', risk: 'read' },
  { tool: 'tail', risk: 'read' },
  { tool: 'find', risk: 'read' },
  { tool: 'diff', risk: 'read' },
  { tool: 'stat', risk: 'read' },
  { tool: 'git_log', risk: 'read' },
  { tool: 'git_diff', risk: 'read' },
  { tool: 'git_show', risk: 'read' },
  { tool: 'git_status', risk: 'read' },
  { tool: 'git_branch', risk: 'read' },
  { tool: 'web_search', risk: 'read' },
  { tool: 'web_fetch', risk: 'read' },
  { tool: 'web_extract', risk: 'read' },
  { tool: 'browser_navigate', risk: 'read' },
  { tool: 'browser_snapshot', risk: 'read' },
  { tool: 'browser_get_images', risk: 'read' },
  { tool: 'browser_console', risk: 'read' },
  { tool: 'session_search', risk: 'read' },
  { tool: 'skills_list', risk: 'read' },
  { tool: 'skill_view', risk: 'read' },
  { tool: 'memory', risk: 'read' },  // memory TOOL is read (save happens via hermes internals)

  // ── Low-risk writes ──
  { tool: 'write_file', risk: 'write-low' },
  { tool: 'patch', risk: 'write-low' },
  { tool: 'todo', risk: 'write-low' },

  // ── High-risk writes (potentially destructive) ──
  { tool: 'terminal', risk: 'write-high' },
  { tool: 'execute_code', risk: 'write-high' },
  { tool: 'delegate_task', risk: 'write-high' },

  // ── External (network calls, data exfiltration risk) ──
  { tool: 'web_search', risk: 'read' }, // already read
  { tool: 'browser_click', risk: 'write-low' },
  { tool: 'browser_type', risk: 'write-low' },
  { tool: 'browser_back', risk: 'read' },
  { tool: 'browser_scroll', risk: 'read' },
]

// Terminal command patterns that upgrade risk from write-high to destructive
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\b/, /\brm\s+.*--no-preserve-root\b/,
  /\bdd\s+if=/, /\bmkfs\b/, /\bmkswap\b/,
  /\bgit\s+push\s+.*--force/, /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f/, /\bchmod\s+.*777\b/,
  /\b>\s*\/dev\//, /\bfork\s+bomb/i,
  /\bdocker\s+rm\s+-f/, /\bdocker\s+system\s+prune\b/,
  /\bkill\s+-9\b/, /\bpkill\b/,
  /\bnpm\s+unpublish/, /\byarn\s+unpublish/,
  /\bDROP\s+(TABLE|DATABASE)/i, /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i, /\bALTER\s+TABLE\b.*DROP/i,
]

// ── User overrides ──

export interface RiskOverride {
  /** Glob pattern matching tool name or tool:args prefix */
  pattern: string
  risk: RiskClass
  /** Specificity score — longer pattern = more specific */
  specificity: number
}

let userOverrides: RiskOverride[] = []

export function setRiskOverrides(overrides: { pattern: string; risk: RiskClass }[]): void {
  userOverrides = overrides.map(o => ({
    ...o,
    specificity: o.pattern.length + (o.pattern.includes(':') ? 1000 : 0),
  }))
}

export function getRiskOverrides(): { pattern: string; risk: RiskClass }[] {
  return userOverrides.map(o => ({ pattern: o.pattern, risk: o.risk }))
}

// ── Classification ──

/**
 * Classify a tool call into one of four risk levels.
 *
 * Priority:
 *   1. User overrides (most-specific glob wins)
 *   2. Destructive terminal command patterns
 *   3. Built-in tool name table
 *   4. Default: write-low (conservative)
 */
export function classifyTool(name: string, args?: string): RiskClass {
  // 1. User overrides
  if (userOverrides.length > 0) {
    // Check tool:name
    const key = `tool:${name}`
    let bestOverride: RiskOverride | null = null
    for (const o of userOverrides) {
      if (matchGlob(o.pattern, key) || matchGlob(o.pattern, name)) {
        if (!bestOverride || o.specificity > bestOverride.specificity) {
          bestOverride = o
        }
      }
      // Also check tool:name:args-prefix
      if (args && matchGlob(o.pattern, `${key}:${args}`)) {
        if (!bestOverride || o.specificity > bestOverride.specificity) {
          bestOverride = o
        }
      }
    }
    if (bestOverride) return bestOverride.risk
  }

  // 2. Destructive terminal commands
  if (name === 'terminal' && args) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(args)) {
        return 'destructive'
      }
    }
  }

  // Also check execute_code for destructive patterns
  if (name === 'execute_code' && args) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(args)) {
        return 'destructive'
      }
    }
  }

  // 3. Built-in table
  for (const rule of BUILTIN_RULES) {
    if (rule.tool === name) {
      if (rule.argPattern && args && rule.argPattern.test(args)) {
        return rule.risk
      }
      if (!rule.argPattern) return rule.risk
    }
  }

  // 4. Conservative default
  return 'write-low'
}

// ── Glob matching (simplified fnmatch) ──

function matchGlob(pattern: string, str: string): boolean {
  // Convert glob to regex
  const reStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  try {
    return new RegExp(`^${reStr}$`, 'i').test(str)
  } catch {
    return pattern === str
  }
}

// ── Display helpers ──

export function riskLabel(risk: RiskClass): string {
  // 语言跟随界面语言（Settings > General）
  const { translate } = require('../../shared/locales')
  const { loadSettings } = require('../settings-store')
  const lang: 'zh' | 'en' = loadSettings().language === 'en' ? 'en' : 'zh'
  switch (risk) {
    case 'read': return translate(lang, 'risk.readBadge')
    case 'write-low': return translate(lang, 'risk.writeLowBadge')
    case 'write-high': return translate(lang, 'risk.writeHighBadge')
    case 'destructive': return translate(lang, 'risk.destructiveBadge')
  }
}

export function riskColor(risk: RiskClass): string {
  switch (risk) {
    case 'read': return '#9CA3AF'          // gray
    case 'write-low': return '#60A5FA'     // blue
    case 'write-high': return '#F59E0B'    // amber
    case 'destructive': return '#EF4444'   // red
  }
}

export function riskIcon(risk: RiskClass): string {
  switch (risk) {
    case 'read': return '👁'
    case 'write-low': return '✏️'
    case 'write-high': return '⚠️'
    case 'destructive': return '🛑'
  }
}
