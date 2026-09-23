// ── Agent type definitions ──

/** Supported agent identifiers */
export type AgentId = 'hermes' | 'openclaw' | 'claude-code' | 'codex' | 'dsh'

/** Agent installation status */
export type AgentStatus = 'not-installed' | 'installed' | 'running' | 'error'

/** Agent information returned by detectors */
export interface InstalledAgent {
  id: AgentId
  name: string
  publisher: string
  version: string
  installPath: string
  status: AgentStatus
  port: number | null
  description: string
  tags: string[]
}

/** Result of a single agent detection scan */
export interface DetectionResult {
  found: boolean
  agent: InstalledAgent | null
  error?: string
}

/** Agent detector interface — each agent detector must implement this */
export interface AgentDetector {
  readonly agentId: AgentId
  readonly agentName: string

  /** Scan the system for this agent, return detection result */
  detect(): Promise<DetectionResult>

  /** Get the install command string (for display to user) */
  getInstallCommand(): string

  /** Execute one-click install */
  install(): Promise<{ success: boolean; error?: string }>

  /** Check if the agent is currently running */
  checkRunning(): Promise<boolean>

  /** Start the agent */
  start(): Promise<{ success: boolean; error?: string }>

  /** Stop the agent */
  stop(): Promise<{ success: boolean; error?: string }>
}

/** Agent protocol — how to communicate with an agent for task execution */
export type AgentProtocol = 'http-sse' | 'cli-spawn' | 'websocket'

/** Task execution request */
export interface TaskRequest {
  task: string
  agentId: AgentId
  contextFolder?: string
  model?: string
}

/** Token usage info from bridge v2 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  /** Estimated current context occupancy (tokens the next call will re-send) */
  contextTokens?: number
}

/** Provider info from bridge ready event */
export interface ProviderInfo {
  provider: string
  model: string
  providers: { name: string; has_key: boolean; base_url: string }[]
}

/** Task execution result metadata */
export interface DoneMeta {
  sessionId: string
  elapsedMs: number
  apiCalls: number
  chunks: number
  completed: boolean
  /** Bridge v2: which model/provider actually ran this turn */
  model?: string
  provider?: string
}

/** Task execution result stream */
export interface TaskStreamCallbacks {
  onChunk: (text: string) => void
  onDone: (sessionId?: string) => void
  onError: (error: string) => void
  onToolProgress?: (tool: string) => void
  onReasoning?: (text: string) => void
  /** bridge: reasoning block closed (explicit boundary before text/tool output) */
  onReasoningEnd?: () => void
  onToolCall?: (name: string, args: string) => void
  onToolResult?: (name: string, content: string) => void
  /** Bridge v2: token usage at turn completion */
  onTokens?: (usage: TokenUsage) => void
  /** Bridge v2: turn metadata */
  onDoneMeta?: (meta: DoneMeta) => void
  /** Bridge v2: provider info on first ready */
  onProviderInfo?: (info: ProviderInfo) => void
  /** P0-2a: graceful interrupt — partial answer preserved, renderer shows "已中断" */
  onInterrupted?: (partialText: string) => void
  /** Phase 6: execution-gate — bridge asks the user before a dangerous command */
  onPermissionRequired?: (req: PermissionRequest) => void
  /** Phase 6: card removed — by timeout, abort, or a decision (first responder wins) */
  onPermissionResolved?: (id: string, reason: 'timeout' | 'abort' | 'responded') => void
  /** cron automation runs: the bridge auto-approves tool calls (no bubble watcher) */
  autoApprove?: boolean
  /** #33: question card raised / resolved */
  onQuestionRequired?: (req: QuestionRequest) => void
  onQuestionResolved?: (id: string, reason: 'timeout' | 'abort' | 'responded') => void
}

/** Phase 6: pending approval surfaced by the bridge's approval callback */
export interface PermissionRequest {
  id: string
  command: string
  description: string
  allowPermanent: boolean
  smartDenied: boolean
  /** #12: risk class from main-side classifyTool; drives card layout */
  risk?: string
}

/** #33: ask_user question card (hermes clarify tool) */
export interface QuestionRequest {
  id: string
  question: string
  choices: string[]
}

/** Agent protocol handler interface */
export interface AgentProtocolHandler {
  readonly protocol: AgentProtocol

  /** Execute a task and stream results */
  execute(request: TaskRequest, callbacks: TaskStreamCallbacks): Promise<{ abort: () => void }>

  /** Check if the protocol is available for this agent */
  isAvailable(agent: InstalledAgent): Promise<boolean>
}
