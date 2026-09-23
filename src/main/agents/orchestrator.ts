/**
 * Task-tree orchestrator (方案 B).
 *
 * Complex tasks are planned into a task tree by the planner profile (kimi-k3),
 * leaf nodes are executed by the worker profile (deepseek-v4-pro), and the
 * planner reviews the combined results into a final answer. The whole tree is
 * streamed to the bubble UI for visualization — DeskApp's differentiator over
 * a plain chat window.
 */
import { spawn, ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { TaskPhase, TaskCondition } from '../../shared/task-state'

// ── Types ──

export interface TreeNode {
  id: string
  title: string
  task: string
  deps: string[]
  /** #34: 'explore' = read-only research node (prompt-enforced, not sandboxed) */
  kind?: 'explore'
  /** shared vocabulary — see src/shared/task-state.ts */
  status: TaskPhase
  conditions?: TaskCondition[]
  elapsedMs?: number
  result?: string
  error?: string
}

export interface TaskTree {
  goal: string
  nodes: TreeNode[]
}

export interface OrchestratorCallbacks {
  onTree: (tree: TaskTree) => void
  onChunk: (text: string) => void
  onError: (err: string) => void
  onDone: () => void
  /** #35: gate execution on user confirmation; return false to reject the plan */
  confirmPlan?: (tree: TaskTree) => Promise<boolean>
}

export interface OrchestratorHandle {
  abort: () => void
  done: Promise<void>
}

/** Internal result — `handled` resolves false when the caller should fall back to the bridge. */
export type OrchestratorResult = OrchestratorHandle & { handled: Promise<boolean> }

// ── Hermes CLI runner ──

const HERMES_BIN = join(homedir(), '.hermes/hermes-agent/venv/bin/hermes')
const PROFILES_ROOT = join(homedir(), '.hermes/profiles')
const PLAN_TIMEOUT_MS = 180_000
const NODE_TIMEOUT_MS = 420_000
const REVIEW_TIMEOUT_MS = 300_000
const MAX_PARALLEL = 3
const MAX_NODES = 8

/** hermes CLI exits 0 even when the API call ultimately fails (429/overload
 *  after retries) — the failure dump lands in stdout. Detect it so callers
 *  get a rejection and the retry/fallback machinery actually engages. */
const FAILURE_RE =
  /💀\s*Final\s*error|API\s+call\s+failed\s+after\s+\d+\s+retries|❌\s*(?:Rate\s*limited|Error|Provider|API)|engine_overloaded_error|⚠️\s*(?:Provider|Model|Endpoint)\s*(?:error|failed|unavailable)|\b(?:invalid_api_key|authentication_error|Incorrect\s+API\s+key)\b|\b(?:insufficient_quota|quota\s+exceeded|billing\s+.*required)\b|\bcontext_length_exceeded\b|\b(?:Connection\s+refused|Connection\s+reset|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b|HTTP\s+(?:5\d{2}|429)|🔥|\bno\s+response\s+from\s+model\b|\btimeout\b.*\b(?:seconds?|request)\b/i

function runHermes(profile: string, prompt: string, timeoutMs: number,
                   running: Set<ChildProcess>): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HERMES_HOME: join(PROFILES_ROOT, profile),
      // Prevent Rich from line-wrapping content inside its response box —
      // a wrapped JSON plan would be unparseable.
      COLUMNS: '2000',
    }
    const child = spawn(HERMES_BIN, ['chat', '-q', prompt], { env })
    running.add(child)
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(child)
      if (code !== 0) {
        reject(new Error((err || out).slice(-400) || `hermes exited ${code}`))
      } else if (FAILURE_RE.test(out)) {
        const why = out.match(/(?:HTTP\s+\d{3}[^'\n]*|💀\s*Final\s*error[^\n]*|❌[^\n]*|⚠️[^\n]*|🔥[^\n]*|invalid_api_key[^\n]*|insufficient_quota[^\n]*|context_length_exceeded[^\n]*|Connection\s+\w+[^\n]*)/i)?.[0] || 'provider call failed'
        reject(new Error(why.trim()))
      } else {
        resolve(out)
      }
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      running.delete(child)
      reject(e)
    })
  })
}

/** A hermes run with tools can leak "[Pasted text #N: M lines → path]"
 *  references into its output (e.g. a worker that browsed ~/.hermes/pastes).
 *  Inline the referenced file content so users never see the raw placeholder. */
const PASTE_REF_RE = /\[Pasted text #\d+: \d+ lines → (.+?)\]/g

function expandPasteRefs(text: string): string {
  return text.replace(PASTE_REF_RE, (m, p) => {
    try {
      const content = readFileSync(String(p).trim(), 'utf-8')
      return content.length > 8000 ? content.slice(0, 8000) + '\n…(内容过长已截断)' : content
    } catch {
      return m
    }
  })
}

/** hermes -q output wraps the answer between a ──── separator and a Session: trailer,
 *  inside a Rich box (╭─ ⚕ Hermes ─╮ / ╰─╯ chrome, content indented). Strip all of it. */
function extractAnswer(raw: string): string {
  const sepIdx = raw.search(/^─{4,}\s*$/m)
  let body = sepIdx >= 0 ? raw.slice(raw.indexOf('\n', sepIdx) + 1) : raw
  const trailer = body.search(/^(Saving session|\.\.\.saving history|Session:|Resume this session)/m)
  if (trailer >= 0) body = body.slice(0, trailer)
  // Drop Rich box chrome, box-border rules, and hermes status/retry noise
  // lines (present when the provider hiccupped mid-run but recovered).
  const NOISE_RE = /^[─╌═]{4,}\s*$|^─+\s*⚕|^[⚠️🔌🌐📝📋⏱❌💀⏳].*(API|Provider|Model|Endpoint|Error|Details|Elapsed|Context|Rate limit|Final error|retr|Waiting)/u
  const lines = body.split('\n')
    .filter(l => !/^\s*[╭╰]/.test(l) && !/^Resume this session/.test(l) && !NOISE_RE.test(l.trim()))
    .map(l => l.replace(/^ {4}/, '').replace(/\s+$/, ''))
  return expandPasteRefs(lines.join('\n').trim())
}

// ── Plan parsing ──

const PLAN_PROMPT = (goal: string) => `你是任务拆解规划器。把用户目标拆成子任务树，交给执行者并行/串行完成。

输出严格 JSON（不要任何解释文字、不要 markdown 代码块）：
{"nodes":[{"id":"1","title":"短标题","task":"给执行者的完整指令，自包含、含必要上下文","deps":[],"kind":"explore"}]}

规则：
- 2 到 6 个节点；每个节点是可由 AI 助手独立完成的具体任务
- deps 是前置节点 id 数组；无依赖的节点会并行执行
- 节点的 task 必须自包含（执行者看不到用户原始目标，也看不到其他节点）
- 如果目标足够简单、不值得拆分，输出恰好 1 个节点
- 纯信息收集/只读调研类节点标注 "kind":"explore"；需要写文件/改代码的节点不要标
- 禁止调用任何工具，直接凭目标文本输出 JSON

用户目标：${goal}`

const REVIEW_PROMPT = (goal: string, results: string) => `你是审查者。用户目标：${goal}

各子任务已完成，结果如下：
${results}

请综合所有结果，给出面向用户的最终回答（中文，简洁，直接回应目标，不要逐条复述子任务）。如果某个子任务失败，说明它对结果的影响并给出可行的替代建议。禁止调用任何工具，仅基于上面给出的结果综合。`

interface RawNode { id?: unknown; title?: unknown; task?: unknown; deps?: unknown; kind?: unknown }

/** Parse and validate the planner's JSON. Returns null when unrecoverable. */
function parsePlan(answer: string, goal: string): TaskTree | null {
  const m = answer.match(/\{[\s\S]*\}/)
  if (!m) return null
  let parsed: { nodes?: RawNode[] }
  try { parsed = JSON.parse(m[0]) } catch { return null }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null

  const nodes: TreeNode[] = []
  for (const raw of parsed.nodes.slice(0, MAX_NODES)) {
    if (typeof raw.id !== 'string' || typeof raw.task !== 'string') return null
    nodes.push({
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : raw.id,
      task: raw.task,
      deps: Array.isArray(raw.deps) ? raw.deps.filter((d): d is string => typeof d === 'string') : [],
      kind: raw.kind === 'explore' ? 'explore' : undefined,
      status: 'pending',
    })
  }
  // Unique ids + deps must reference known ids
  const ids = new Set(nodes.map(n => n.id))
  if (ids.size !== nodes.length) return null
  for (const n of nodes) n.deps = n.deps.filter(d => ids.has(d) && d !== n.id)
  // Acyclic check via topo sort
  const done = new Set<string>()
  let progress = true
  while (done.size < nodes.length && progress) {
    progress = false
    for (const n of nodes) {
      if (!done.has(n.id) && n.deps.every(d => done.has(d))) { done.add(n.id); progress = true }
    }
  }
  if (done.size < nodes.length) return null
  return { goal, nodes }
}

// ── Orchestrator ──

/**
 * Plan and execute a complex task as a task tree.
 * Returns null when planning fails or the goal isn't worth a tree — the
 * caller should then fall back to the normal bridge path.
 */
export function runTaskTree(goal: string, cbs: OrchestratorCallbacks): OrchestratorResult | null {
  const running = new Set<ChildProcess>()
  let aborted = false

  const emit = (tree: TaskTree): void => { if (!aborted) cbs.onTree(JSON.parse(JSON.stringify(tree))) }
  const clearTree = (): void => { if (!aborted) cbs.onTree({ goal, nodes: [] }) }

  // Instant feedback: the hermes CLI plan call takes 10-20s cold (one-shot
  // process startup + API RTT). Show a placeholder node immediately so the
  // bubble never looks dead between send and the real plan arriving.
  emit({ goal, nodes: [{ id: '__planning__', title: '正在规划任务树…', task: goal, deps: [], status: 'running' }] })

  const done = (async () => {
    // 1. Plan
    let tree: TaskTree | null = null
    try {
      const planRaw = await runHermes('planner', PLAN_PROMPT(goal), PLAN_TIMEOUT_MS, running)
      const answer = extractAnswer(planRaw)
      console.log('[Orchestrator] plan answer (first 600):', answer.slice(0, 600).replace(/\n/g, ' ⏎ '))
      tree = parsePlan(answer, goal)
    } catch (e) {
      // Aborted during planning → claim handled; falling back to the bridge
      // would re-execute the very task the user just aborted.
      if (aborted) return true
      console.log('[Orchestrator] planning failed:', (e as Error).message)
      clearTree()
      return false // fall back to bridge
    }
    if (!tree || tree.nodes.length < 2) {
      console.log('[Orchestrator] plan not tree-worthy, falling back')
      clearTree()
      return false
    }
    emit(tree)

    // #35: plans with many nodes ask the user before executing (threshold:
    // small trees stream by unbothered; ponytail: constant, add a setting if users ask)
    if (cbs.confirmPlan && tree.nodes.length >= 4) {
      let ok = false
      try { ok = await cbs.confirmPlan(JSON.parse(JSON.stringify(tree))) } catch { ok = false }
      if (aborted) return true
      if (!ok) {
        clearTree()
        cbs.onChunk('（已取消任务树执行）')
        return true
      }
      emit(tree)
    }

    // 2. Execute leaves in dependency order, bounded parallelism
    const byId = new Map(tree.nodes.map(n => [n.id, n]))
    const runNode = async (n: TreeNode): Promise<void> => {
      if (aborted) { n.status = 'failed'; n.error = 'aborted'; emit(tree!); return }
      n.status = 'running'
      emit(tree!)
      const t0 = Date.now()
      const depContext = n.deps
        .map(d => byId.get(d))
        .filter((d): d is TreeNode => !!d && d.status === 'done')
        .map(d => `【前置结果 · ${d.title}】\n${(d.result || '').slice(0, 2000)}`)
        .join('\n\n')
      const base = depContext ? `${n.task}\n\n可参考的前置任务结果：\n${depContext}` : n.task
      // #34: explore nodes run read-only (prompt-enforced — ponytail: not sandboxed, add toolset gating if explore proves leaky)
      const prompt = n.kind === 'explore'
        ? `【只读调研任务 — 禁止修改、创建或删除任何文件，禁止执行有副作用的命令；仅读取、搜索、总结】\n${base}`
        : base
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await runHermes('worker', prompt, NODE_TIMEOUT_MS, running)
          n.result = extractAnswer(raw)
          n.status = 'done'
          n.elapsedMs = Date.now() - t0
          emit(tree!)
          return
        } catch (e) {
          if (aborted || attempt === 1) {
            n.status = 'failed'
            n.error = (e as Error).message.slice(0, 200)
            n.elapsedMs = Date.now() - t0
            emit(tree!)
            return
          }
          console.log(`[Orchestrator] node ${n.id} attempt 1 failed, retrying:`, (e as Error).message)
        }
      }
    }

    const pending = new Set(tree.nodes)
    const inFlight = new Set<Promise<void>>()
    while (!aborted && [...pending].some(n => n.status === 'pending' || n.status === 'running')) {
      let launched = false
      for (const n of pending) {
        if (n.status !== 'pending') continue
        if (!n.deps.every(d => byId.get(d)?.status === 'done')) continue
        if (inFlight.size >= MAX_PARALLEL) break
        const p = runNode(n).finally(() => inFlight.delete(p))
        inFlight.add(p)
        launched = true
      }
      if (inFlight.size > 0) await Promise.race(inFlight)
      else if (!launched) break // deps on failed nodes → stuck
    }
    await Promise.all(inFlight)

    // Nodes whose deps failed never launched — mark them failed (skipped)
    for (const n of tree.nodes) {
      if (n.status === 'pending') { n.status = 'failed'; n.error = 'skipped (dependency failed)' }
    }
    emit(tree)
    if (aborted) return true

    // 3. Review → final answer
    const results = tree.nodes
      .map(n => `【${n.title}】${n.status === 'done' ? '✅' : '❌ ' + (n.error || '')}\n${(n.result || '').slice(0, 3000)}`)
      .join('\n\n')
    try {
      const reviewRaw = await runHermes('planner', REVIEW_PROMPT(goal, results), REVIEW_TIMEOUT_MS, running)
      if (!aborted) cbs.onChunk(extractAnswer(reviewRaw))
    } catch (e) {
      if (!aborted) cbs.onError('review failed: ' + (e as Error).message)
    }
    if (!aborted) cbs.onDone()
    return true
  })()

  // If planning fails we must tell the caller to fall back — signal via done resolving false.
  const handle: OrchestratorResult = {
    abort: () => {
      aborted = true
      for (const c of running) { try { c.kill('SIGKILL') } catch { /* ignore */ } }
    },
    done: done.then(() => undefined),
    handled: done,
  }
  return handle
}
