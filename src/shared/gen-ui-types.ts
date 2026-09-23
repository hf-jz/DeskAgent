// ── Shared types used by main+renderer (no main-process imports) ──
export const COMPONENT_KINDS = [
  'dashboard', 'feed', 'monitor', 'checklist', 'counter',
  'clock', 'chart', 'alerts', 'text', 'links', 'image', 'iframe',
  // ── 办公创作: 设计界面 → agent 生成成品 (HTML PPT/画册/手册/动画) ──
  'presentation', 'brochure', 'manual', 'video', 'homepage',
] as const

export type ComponentKind = typeof COMPONENT_KINDS[number]

/** 办公创作 kinds — 卡片窗口渲染设计界面而非通用成绩卡。 */
export const CONTENT_KINDS = new Set<string>(['presentation', 'brochure', 'manual', 'video', 'homepage'])

export interface WindowSpec {
  /** written by validateSpec — see SPEC_SCHEMA_VERSION */
  schemaVersion?: number
  id: string
  title: string
  kind: string
  cron?: {
    schedule: string
    prompt: string
    standingGrants?: string[]
  }
  props: Record<string, any>
  layout?: { x?: number; y?: number; w?: number; h?: number }
}

export interface SpecStatus {
  specId: string
  status: 'idle' | 'running' | 'ok' | 'error'
  lastRun?: number
  jobId?: string
  error?: string
}

// ── Validation (pure, shared so tests can import without electron) ──
const KIND_SET = new Set<string>(COMPONENT_KINDS)

/**
 * Bumped when a WindowSpec field changes meaning. Stamped on every save, so a
 * spec written today can be migrated later instead of guessed at.
 * (ax lesson: manifests carry apiVersion for exactly this reason —
 * docs/ax/01-borrow-list.md A2.)
 */
export const SPEC_SCHEMA_VERSION = 1

/** Fields a WindowSpec may carry. Anything else is a typo or schema drift. */
export const SPEC_KNOWN_FIELDS = ['schemaVersion', 'id', 'title', 'kind', 'cron', 'props', 'layout'] as const

/** Unknown top-level fields — empty for a well-formed spec. */
export function specUnknownFields(spec: unknown): string[] {
  if (!spec || typeof spec !== 'object') return []
  const known = new Set<string>(SPEC_KNOWN_FIELDS)
  return Object.keys(spec as Record<string, unknown>).filter((k) => !known.has(k))
}

/**
 * @param strict reject unknown fields. Use on deliberate input (user edits,
 *   agent tool calls, patches): a typo must fail loudly, not vanish silently.
 *   LLM output stays lenient — unknown keys are dropped and reported through
 *   `specUnknownFields()` so the caller can log them.
 */
export function validateSpec(spec: unknown, opts: { strict?: boolean } = {}): WindowSpec | { error: string } {
  const s = spec as any
  if (!s || typeof s !== 'object') return { error: 'spec must be an object' }
  const unknown = specUnknownFields(s)
  if (unknown.length && opts.strict) {
    return { error: `unknown field(s): ${unknown.join(', ')} — allowed: ${SPEC_KNOWN_FIELDS.join(', ')}` }
  }
  if (!s.id || typeof s.id !== 'string') return { error: 'spec.id required (string)' }
  if (!s.title || typeof s.title !== 'string') return { error: 'spec.title required (string)' }
  if (!KIND_SET.has(s.kind)) return { error: `unknown kind: ${s.kind}` }
  if (s.cron) {
    if (typeof s.cron.schedule !== 'string' || typeof s.cron.prompt !== 'string')
      return { error: 'cron.schedule and cron.prompt required (string)' }
  }
  if (s.props && typeof s.props !== 'object') return { error: 'props must be an object' }
  return {
    // stamp the schema version so later migrations have an anchor
    schemaVersion: typeof s.schemaVersion === 'number' ? s.schemaVersion : SPEC_SCHEMA_VERSION,
    id: s.id,
    title: s.title,
    kind: s.kind,
    cron: s.cron ? {
      schedule: s.cron.schedule,
      prompt: s.cron.prompt,
      standingGrants: s.cron.standingGrants || [],
    } : undefined,
    props: s.props || {},
    layout: s.layout,
  } as WindowSpec
}

// ── JSON Patch (RFC 6902 subset: add/remove/replace, /a/b path segments) ──
export interface PatchOp { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }

function parsePath(path: string): string[] | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  return path.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** Pure: returns a new object with ops applied, or {error}. Never mutates input. */
export function applyPatch(doc: unknown, ops: unknown): unknown | { error: string } {
  if (!Array.isArray(ops) || !ops.length) return { error: 'ops must be a non-empty array' }
  if (ops.length > 50) return { error: 'too many ops (max 50)' }
  let root: any = JSON.parse(JSON.stringify(doc ?? {}))
  for (const raw of ops) {
    const op = raw as PatchOp
    if (!op || !['add', 'remove', 'replace'].includes(op.op)) return { error: `bad op: ${(raw as any)?.op}` }
    const segs = parsePath(op.path)
    if (!segs || !segs.length) return { error: `bad path: ${op.path}` }
    // walk to parent
    let parent = root
    for (let i = 0; i < segs.length - 1; i++) {
      parent = parent?.[segs[i]]
      if (parent == null || typeof parent !== 'object') return { error: `path not found: ${op.path}` }
    }
    const key = segs[segs.length - 1]
    if (op.op === 'remove') {
      if (!(key in parent)) return { error: `path not found: ${op.path}` }
      if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key]
    } else {
      if (op.op === 'replace' && !(key in parent)) return { error: `path not found: ${op.path}` }
      parent[key] = op.value === undefined ? null : JSON.parse(JSON.stringify(op.value))
    }
  }
  return root
}

// ── Webhook payload formatting (pure, test-importable) ──
/** Light markdown → plain text for chat bots that can't render markdown. */
export function stripMd(s: string): string {
  return s
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, cells: string) => cells.split('|').map((c: string) => c.trim()).filter(Boolean).join('  '))
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[`_~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Repair markdown that agents mangle: table rows glued onto one line (GFM
 *  needs the newlines to render) and QuickChart URLs left as bare text. */
export function normalizeMd(s: string): string {
  return s
    .replace(/\|\s+\|/g, '|\n|')
    .replace(/(https:\/\/quickchart\.io\/chart\?[^\s)\]]+)/g, '![chart]($1)')
    .trim()
}

export function webhookBody(url: string, payload: Record<string, any>): string {
  const text = `[deskapp] ${payload.event} ${payload.title || payload.specId || ''}${payload.ok === false ? ' ⚠️失败' : ''}${payload.output ? '\n\n' + payload.output : ''}`.trim()
  if (url.includes('qyapi.weixin.qq.com')) return JSON.stringify({ msgtype: 'text', text: { content: stripMd(text) } })
  if (url.includes('open.feishu.cn') || url.includes('open.larksuite.com'))
    return JSON.stringify({ msg_type: 'text', content: { text: stripMd(text) } })
  return JSON.stringify({ ...payload, ts: Date.now(), app: 'deskapp' })
}

// ── Rect overlap (pure) — card-window drag-to-dock archive decision ──
export function rectOverlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (ix <= 0 || iy <= 0) return 0
  return (ix * iy) / (a.width * a.height)
}
