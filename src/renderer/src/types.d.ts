/**
 * Global type declarations for DeskApp renderer process.
 * The deskAppAPI is exposed by contextBridge in the preload script.
 *
 * Domain types are imported from the shared IPC contract (src/shared/ipc-channels.ts)
 * so they stay in sync with the handler signatures automatically.
 */

import type {
  PetSettings,
  BrainMode,
  TokenUsage as TokenUsageEvent,
  AgentInfo,
  AgentState,
  SessionEntry,
  CategoryData,
  CommunityResponse,
  GitHubSearchResult,
  OnboardingState,
  LLMConfig,
  BrainSlotConfig,
  CommunitySkillData,
  SkillEntry,
  FeedPayload,
  FeedItem,
} from '../../shared/ipc-channels'

interface DeskAppAPI {
  // App info
  getAppInfo: () => Promise<{ platform: string; version: string; name: string }>
  hidePet: () => Promise<void>
  showPet: () => Promise<void>
  getPetBounds: () => Promise<Electron.Rectangle | null>
  walkPet: (dx: number, durationMs: number) => Promise<number>

  // Conversational onboarding
  getOnboardingState: () => Promise<OnboardingState>
  testLLMConnection: (config: LLMConfig) => Promise<{ success: boolean; message: string }>
  saveLLMConfig: (config: LLMConfig, providerId: string) => Promise<{ ok: boolean }>
  saveBrainConfig: (planner: BrainSlotConfig, worker: BrainSlotConfig) => Promise<{ ok: boolean; errors?: string[] }>

  // Pet interaction
  openPet: () => Promise<void>
  showContextMenu: () => Promise<void>

  // Drag
  sendDragStart: (x: number, y: number) => void
  sendDragMove: (dx: number, dy: number) => void
  sendDragEnd: () => void

  // Pet feeding
  feedHover: () => void
  feedLeave: () => void
  sendFeed: (paths: string[]) => void
  onPetSay: (callback: (text: string, ms: number) => void) => () => void
  onFeedAnalyze: (callback: (payload: FeedPayload) => void) => () => void
  takeFeed: () => FeedPayload | null
  buildFeed: (paths: string[]) => Promise<FeedPayload>
  expandFeed: (path: string) => Promise<FeedItem[]>

  // Settings
  openSettings: () => Promise<void>
  getSettings: () => Promise<PetSettings>
  updateSettings: (updates: Partial<PetSettings>) => Promise<PetSettings>
  onSettingsChanged: (callback: (s: PetSettings) => void) => () => void

  // Task events
  onTaskChunk: (callback: (text: string) => void) => () => void
  onTaskDone: (callback: (sessionId?: string) => void) => () => void
  onTaskError: (callback: (error: string) => void) => () => void
  onReasoningChunk: (callback: (text: string) => void) => () => void
  /** thinking block closed — explicit boundary, no inference needed */
  onReasoningEnd: (callback: () => void) => () => void
  onToolCall: (callback: (name: string, args: string) => void) => () => void
  onToolResult: (callback: (name: string, content: string) => void) => () => void
  onTokenUsage: (callback: (usage: TokenUsageEvent) => void) => () => void
  onTurnDoneMeta: (callback: (meta: { sessionId: string; elapsedMs: number; apiCalls: number; chunks: number; completed: boolean; model?: string; provider?: string; via?: string }) => void) => () => void
  onTurnStartMeta: (callback: (meta: { model?: string }) => void) => () => void
  onTreeUpdate: (callback: (tree: { goal: string; nodes: { id: string; title: string; task: string; deps: string[]; status: 'pending' | 'running' | 'done' | 'failed'; elapsedMs?: number; result?: string; error?: string }[] }) => void) => () => void
  onAgentStateChanged: (callback: (state: AgentState) => void) => () => void
  /** P0-1: unified canonical agent event stream */
  onAgentEvent: (callback: (event: import('../../shared/agent-events').AgentEvent) => void) => () => void
  /** P0-2a: graceful interrupt — partial answer kept, streaming finalized */
  onTaskInterrupted: (callback: (partialText: string) => void) => () => void

  // Session grants (P0-4A)
  listGrants: () => Promise<import('../../shared/ipc-channels').GrantInfo[]>
  removeGrant: (kind: string, tool: string, command?: string, path?: string) => Promise<boolean>
  clearGrants: () => Promise<void>
  checkInputGrant: (categories: string[]) => Promise<boolean>
  addInputGrant: (categories: string[]) => Promise<boolean>
  addGrant: (kind: string, tool: string, command?: string, path?: string) => Promise<boolean>

  // P1-B3 #16: memory management
  listMemory: () => Promise<any[]>
  addMemory: (scope: string, value: string, key?: string) => Promise<boolean>
  updateMemory: (id: number, value: string) => Promise<boolean>
  forgetMemory: (id: number) => Promise<boolean>
  moveMemory: (id: number, scope: string) => Promise<boolean>

  // Inbox (P0-5)
  listInbox: () => Promise<import('../../shared/ipc-channels').InboxItemInfo[]>
  getInboxCount: () => Promise<number>
  resolveInboxItem: (id: string, by?: string) => Promise<boolean>
  onInboxChanged: (callback: (openCount: number) => void) => () => void

  // Permission gate (Phase 6)
  respondPermission: (id: string, outcome: 'once' | 'session' | 'always' | 'deny' | 'turn', command?: string) => Promise<boolean>
  onPermissionRequired: (callback: (req: { id: string; command: string; description: string; allowPermanent: boolean; smartDenied: boolean; risk?: string }) => void) => () => void
  onPermissionResolved: (callback: (info: { id: string; reason: 'timeout' | 'abort' | 'responded' }) => void) => () => void
  onQuestionRequired: (callback: (req: { id: string; question: string; choices: string[] }) => void) => () => void
  onQuestionResolved: (callback: (info: { id: string; reason: string }) => void) => () => void
  respondQuestion: (id: string, answer: string) => Promise<boolean>
  onPlanProposed: (callback: (info: { tree: any }) => void) => () => void
  confirmPlan: (ok: boolean) => Promise<boolean>

  // Agents
  scanAgents: () => Promise<AgentState>
  getAgentState: () => Promise<AgentState>
  setActiveAgent: (id: string | null) => Promise<boolean>
  executeTask: (task: string, options?: { modelMode?: BrainMode; sessionId?: string }) => Promise<{ success: boolean }>
  // P1-B3 #23: provider info & verification
  getProviderInfo: () => Promise<{ provider: string; workerModel: string; plannerModel: string; capabilities: { worker: any; planner: any } }>
  verifyProvider: () => Promise<{ ok: boolean; latencyMs?: number; model?: string; error?: string }>
  updateModels: (plannerModel: string, workerModel: string) => Promise<{ ok: boolean; plannerModel: string; workerModel: string }>
  getBrainConfig: () => Promise<{ planner: { provider: string; model: string; baseURL: string }; worker: { provider: string; model: string; baseURL: string } }>
  abortTask: () => void
  openBubble: () => Promise<void>
  getInstallCommands: () => Promise<Record<string, string>>
  getAuditLog: () => Promise<{ ts: string; event: string; name: string; detail: string }[]>
  listDeadLetters: () => Promise<{ ts: number; kind: string; summary: string; detail?: string }[]>
  /** environment self-check (python / bundle / key / disk / memory) */
  runDoctor: () => Promise<import('../../shared/ipc-channels').DoctorReport>
  checkUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  dismissUpdate: (version: string) => Promise<boolean>
  getUpdateStatus: () => Promise<any>
  onUpdateStatus: (cb: (status: any) => void) => () => void
  extractPdf: (path: string) => Promise<string | null>
  openOnboarding: () => Promise<boolean>
  onOnboardingShow: (cb: () => void) => () => void
  listSessions: () => Promise<SessionEntry[]>
  renameSession: (sid: string, title: string) => Promise<boolean>
  pinSession: (sid: string, pinned: boolean) => Promise<boolean>
  archiveSession: (sid: string, archived: boolean) => Promise<boolean>
  deleteSession: (sid: string) => Promise<boolean>
  restoreSession: (sid: string) => Promise<{ messages: any[]; timestamp: number } | null>
  installAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>

  // Bubble
  resizeBubble: (height: number) => void
  minimizeBubble: () => void
  maximizeBubble: () => void
  closeBubble: () => void

  // VFS
  getVfsFiles: () => Promise<{ name: string; path: string; size: number; ext: string; createdAt: number }[]>
  getWorkspaceDir: () => Promise<string>
  vfsImport: (path: string) => Promise<string>
  getFilePath: (file: File) => string
  readVfsFile: (name: string) => Promise<string | null>
  openVfsFile: (name: string) => Promise<void>
  revealVfsFile: (name: string) => Promise<void>
  listVfsRoots: () => Promise<string[]>
  addVfsRoot: (dir: string) => Promise<boolean>
  removeVfsRoot: (dir: string) => Promise<boolean>
  listPersonas: () => Promise<{ personas: { id: string; name: string; systemPrefix: string }[]; activeId: string | null }>
  savePersona: (p: { id?: string; name: string; systemPrefix: string }) => Promise<any>
  deletePersona: (id: string) => Promise<boolean>
  setActivePersona: (id: string | null) => Promise<boolean>
  mcpStatus: () => Promise<{ servers: { name: string; transport: string }[]; configPath: string }>
  openFileExplorer: () => Promise<void>

  // Sessions
  saveSession: (sid: string, data: any) => Promise<void>
  loadSession: (sid: string) => Promise<{ messages: any[]; timestamp: number } | null>
  listCronJobs: () => Promise<any[]>
  createCronJob: (job: any) => Promise<any>
  updateCronJob: (id: string, patch: any) => Promise<void>
  deleteCronJob: (id: string) => Promise<void>

  // Debug
  logMessage: (msg: string) => void

  // Agent stats
  getAgentStats: () => Promise<any>
  trackToolCall: (name: string, ok: boolean, dur: number) => Promise<void>
  trackError: (pattern: string, suggestion: string) => Promise<void>
  trackAttempt: (task: string, attempt: number, approach: string, ok: boolean) => Promise<void>
  trackContextBullet: (id: string, desc: string) => Promise<void>
  trackDecision: (target: string, prediction: string, actual: string, verified: boolean) => Promise<void>
  updateCapabilityScore: (name: string, score: number, max: number) => Promise<void>

  // Skill Hub
  skillsList: () => Promise<SkillEntry[]>
  skillsGet: (name: string) => Promise<SkillEntry | null>
  skillsInstall: (skill: unknown) => Promise<boolean>
  skillsRemove: (name: string) => Promise<boolean>
  skillsSetActive: (name: string, active: boolean, agent?: string) => Promise<boolean>
  skillsSyncHermes: () => Promise<{ synced: number; failed: string[] }>
  skillsSyncClaude: () => Promise<any>
  skillsSyncCursor: () => Promise<any>
  skillsSyncCodex: () => Promise<any>
  skillsSyncOpenClaw: () => Promise<any>
  skillsCount: () => Promise<number>
  skillsCategories: () => Promise<CategoryData>
  skillsDiscover: () => Promise<any[]>
  skillsCommunityRegistry: () => Promise<{ version: number; skills: any[] }>
  skillsRefreshCommunity: () => Promise<CommunityResponse>
  skillsSearchGitHub: () => Promise<GitHubSearchResult>
  skillsInstallRemote: (rawUrl: string, name: string, category: string) => Promise<{ ok: boolean; name?: string; error?: string }>

  // Habit Engine
  habitGetState: () => Promise<{ collector: string; eventCount: number; segmentCount: number; lastSampleAt: number | null; privacyPaused: boolean; habitEnabled: boolean; aiSummaryEnabled: boolean; collectorErrors: number; lastCollectorError: string }>
  habitGetEvents: (limit?: number) => Promise<{ id: number; ts: number; kind: string; app: string; title: string; url: string; duration: number }[]>
  habitGetHabits: () => Promise<{ id: number; name: string; kind: string; triggerJson: string; patternJson: string; confidence: number; evidenceCount: number; firstSeen: string; lastSeen: string; status: string; userNote: string }[]>
  habitGetSegments: (date: string) => Promise<any[]>
  habitPause: () => Promise<void>
  habitResume: () => Promise<void>
  habitGetBriefing: () => Promise<any>
  habitGetContextText: (userMessage?: string, currentApp?: string) => Promise<string>
  habitGetDeviations: (currentApp?: string) => Promise<any[]>
  habitConfirm: (id: number) => Promise<void>
  habitDismiss: (id: number) => Promise<void>
  habitActivate: (id: number) => Promise<void>
  habitExtract: () => Promise<{ newHabits: number; totalCandidates: number }>
  habitAutomation: () => Promise<{ workflows: any[]; proposals: any[] }>
  habitRunPipeline: () => Promise<{ summary: string | null; mode: string; newHabits: number; totalCandidates: number; maintenance: string }>
  habitGetScore: () => Promise<number>
  habitExecute: (id: number) => Promise<{ ok: boolean; opened: string[]; error?: string }>
  habitGetWeeklyReport: () => Promise<{ text: string; date: string } | null>
  habitGetScoreInsight: () => Promise<{ score: number; insight: string; source: 'llm' | 'local' }>
  habitRunWeekly: () => Promise<{ summary: string | null; mode: string; newHabits: number; totalCandidates: number; maintenance: string; workflows: any[]; proposals: any[] }>
  habitIsEnabled: () => Promise<boolean>
  habitSetEnabled: (enabled: boolean) => Promise<void>
  habitIsAISummary: () => Promise<boolean>
  habitSetAISummary: (enabled: boolean) => Promise<void>
  habitExport: () => Promise<string>
  habitDeleteAll: () => Promise<void>

  // P2-C1 #29/#30: secrets + workspace trust
  listSecrets: () => Promise<string[]>
  setSecret: (name: string, value: string) => Promise<boolean>
  deleteSecret: (name: string) => Promise<boolean>
  listTrusted: () => Promise<string[]>
  trustDir: (dir: string) => Promise<boolean>
  untrustDir: (dir: string) => Promise<boolean>
  trustStatus: () => Promise<{ dir: string; trusted: boolean }>

  // Generative UI
  genui: {
    listSpecs: () => Promise<any[]>
    listStatuses: () => Promise<any[]>
    runSpec: (id: string) => Promise<{ ok: boolean; jobId?: string; error?: string }>
    removeSpec: (id: string) => Promise<{ ok: boolean }>
    modifySpec: (id: string, instruction: string) => Promise<any>
    focusSpec: (id: string) => void
    open: () => void
    getWebhook: () => Promise<string>
    setWebhook: (url: string) => Promise<void>
  }
  onSpecChanged: (callback: (spec: any) => void) => () => void
  onSpecRemoved: (callback: (id: string) => void) => () => void
  onStatusChanged: (callback: (status: any) => void) => () => void
}

declare global {
  interface Window {
    deskAppAPI: DeskAppAPI
  }
}

export {}
