/**
 * Task tier router — "frontier-model plans, cheap-model executes" economics.
 *
 *  - simple  → run directly on the cheap worker model (deepseek-v4-pro),
 *              the frontier planner (kimi-k3) never sees the request.
 *  - complex → run through the planner (default model), which decomposes
 *              the goal and delegates execution to worker subagents
 *              (pinned to deepseek-v4-pro via hermes delegation.* config).
 *
 * v1 classification is rule-based (zero cost, zero latency). If it says
 * "simple" wrongly, the worst case is a deepseek answer where k3 would
 * have been better — cheap to retry with /retry or a rephrase.
 */

export type TaskTier = 'simple' | 'complex'

/** Signals that a task needs tools, files, multi-step work, or code → planner */
const COMPLEX_PATTERNS: RegExp[] = [
  // Engineering verbs (zh)
  /实现|开发|搭建|重构|修复|调试|部署|安装|配置|优化|改造|迁移|排查/,
  /写(一个|个|一段|下)?(脚本|程序|代码|函数|组件|页面|技能)/,
  // Nouns implying repo/tooling context (zh)
  /代码|文件|目录|仓库|代码库|项目|构建|编译|测试用例|命令行|终端/,
  // Engineering verbs + context (en)
  /\b(implement|refactor|debug|fix|build|deploy|install|configure|migrate|optimize|compile)\b/i,
  /\b(code|codebase|repo|repository|file|directory|project|commit|branch|docker)\b/i,
  // Multi-step markers
  /然后|接着|第一步|步骤|并且|同时|首先|其次/,
  /最后|分别|对比|汇总|综合|并把|并将|挨个|逐一/,
]

/** Anything longer than this is treated as complex regardless of keywords */
const COMPLEX_LENGTH_THRESHOLD = 120

export function classifyTask(task: string): TaskTier {
  const text = task.trim()
  if (text.length > COMPLEX_LENGTH_THRESHOLD) return 'complex'
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(text)) return 'complex'
  }
  return 'simple'
}

/** Cheap worker model identity — keep in sync with hermes config delegation.* */
// ponytail: flash to match ~/.hermes/config.yaml default — v4-pro's reasoning
// TTFT (30-40s) read as "stuck thinking" on first ask; terminal hermes has no
// such delay because it uses flash.
export let WORKER_MODEL = 'deepseek-v4-flash'
export let WORKER_PROVIDER = 'deepseek'
/** Planner model identity — task-tree planning/review + default bridge tier. */
export let PLANNER_MODEL = 'kimi-k3'

/** Update runtime model identities + persist to config.yaml.
 *  Called from Settings > Appearance when the user edits model names. */
export function updateModelIdentities(workerModel?: string, plannerModel?: string): void {
  if (workerModel) WORKER_MODEL = workerModel
  if (plannerModel) PLANNER_MODEL = plannerModel
}
