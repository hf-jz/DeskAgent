/**
 * Model capability table — drives UI visibility (attachment types, model
 * features) and provides capabilities info to the renderer.
 *
 * Known models are hardcoded; unknown models get a safe default. Hermes's own
 * internal registries (_PROVIDERS_WITHOUT_VISION etc.) are intentionally NOT
 * consulted — they are hermes implementation details that may change.
 */

export interface ModelCapabilities {
  /** Supports function/tool calling */
  tools: boolean
  /** Supports image input (vision) */
  vision: boolean
  /** Supports PDF input */
  pdf: boolean
  /** Supports SSE streaming */
  streaming: boolean
  /** Supports reasoning_content (thinking / chain-of-thought deltas) */
  reasoning: boolean
}

/** Known model → capabilities. Add new models here as they are adopted. */
const TABLE: Record<string, ModelCapabilities> = {
  // DeepSeek family
  'deepseek-v4-pro':   { tools: true, vision: false, pdf: false, streaming: true, reasoning: false },
  'deepseek-chat':     { tools: true, vision: false, pdf: false, streaming: true, reasoning: false },
  'deepseek-reasoner': { tools: false, vision: false, pdf: false, streaming: true, reasoning: true },

  // Kimi / Moonshot family
  'kimi-k3':           { tools: true, vision: true,  pdf: false, streaming: true, reasoning: false },
  'kimi-coding-cn':    { tools: true, vision: false, pdf: false, streaming: true, reasoning: false },

  // OpenAI family
  'gpt-5':             { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },
  'gpt-4o':            { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },
  'gpt-4o-mini':       { tools: true, vision: true,  pdf: false, streaming: true, reasoning: false },

  // Anthropic family
  'claude-sonnet-4':   { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },
  'claude-opus-4':     { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },

  // Google family
  'gemini-2.5-pro':    { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },
  'gemini-2.5-flash':  { tools: true, vision: true,  pdf: true,  streaming: true, reasoning: false },
}

/** Safe default for unknown models: assume tools + streaming, no vision/PDF. */
const DEFAULT: ModelCapabilities = {
  tools: true, vision: false, pdf: false, streaming: true, reasoning: false,
}

/** Look up capabilities for a model name. Falls back to DEFAULT for unknowns. */
export function getCapabilities(model: string): ModelCapabilities {
  return TABLE[model] ?? DEFAULT
}

/** Human-readable label for a single capability. */
export function capabilityLabel(key: keyof ModelCapabilities): string {
  const labels: Record<keyof ModelCapabilities, string> = {
    tools: '工具调用',
    vision: '图片理解',
    pdf: 'PDF 解析',
    streaming: '流式输出',
    reasoning: '深度思考',
  }
  return labels[key]
}

/** Summary line for display in settings / model selector. */
export function capabilitiesSummary(caps: ModelCapabilities): string {
  const parts: string[] = []
  for (const k of ['tools', 'vision', 'pdf', 'streaming', 'reasoning'] as (keyof ModelCapabilities)[]) {
    if (caps[k]) parts.push(capabilityLabel(k))
  }
  return parts.length > 0 ? parts.join(' · ') : '基础对话'
}
