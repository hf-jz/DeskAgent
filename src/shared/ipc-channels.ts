/**
 * IPC Channel Contract — Single Source of Truth
 *
 * This file defines ALL IPC channels used between main and renderer processes.
 * It is imported by:
 *   - src/shared/ipc-main.ts     (main process handler registration)
 *   - src/shared/ipc-renderer.ts (preload script invocation)
 *
 * Three channel categories:
 *   IpcInvokeMap  → ipcMain.handle / ipcRenderer.invoke  (request → response)
 *   IpcSendMap    → ipcMain.on      / ipcRenderer.send    (fire-and-forget, renderer→main)
 *   IpcPushMap    → webContents.send / ipcRenderer.on     (push events, main→renderer)
 *
 * To add a new channel, add one entry to the appropriate map below.
 * Both main and renderer sides will get automatic type checking.
 */

import type { TaskPhase, TaskCondition } from './task-state'

// ══════════════════════════════════════════════════════════════════════════
// Shared domain types (extracted from business layer for contract purity)
// ══════════════════════════════════════════════════════════════════════════

/** Custom (user photo) pet asset — PNG + spritesheet in userData/custom-pet/<id>*.png */
export interface CustomPetInfo {
  id: string
  name: string
  createdAt: number
}

/** Pet pose → spritesheet row layout (kept in sync with spritesheet.ts) */
export const SPRITE_FRAME = 128
export const SPRITE_COLS = 8
export const SPRITE_ROWS = 5

export interface PetSettings {
  animStyle: 'strands' | 'rings'
  petStyle?: 'mochi' | 'bobo' | 'strands' | 'rings' | 'custom'
  /** Active custom pet; petStyle === 'custom' renders it. */
  customPet?: CustomPetInfo
  /** All saved custom pets (the library). */
  customPets?: CustomPetInfo[]
  size: 'S' | 'M' | 'L'
  opacity: number
  budgetDaily?: number
  budgetMonthly?: number
  onboardingDismissedAt?: number
  /** Default brain mode for NEW bubbles (per-bubble pill overrides). */
  brainMode?: BrainMode
  /** P0-10: UI theme — light / dark / auto (follows prefers-color-scheme) */
  theme?: 'light' | 'dark' | 'auto'
  /** i18n: UI + assistant reply language */
  language?: 'zh' | 'en'
  /** P0-3: user overrides for built-in tool risk classification (glob patterns) */
  toolRiskOverrides?: { pattern: string; risk: 'read' | 'write-low' | 'write-high' | 'destructive' }[]
}

/**
 * Brain mode — which model(s) drive a conversation:
 *   auto    → tier router: simple turns on the worker, complex on the
 *             planner task tree (cost-optimal default)
 *   worker  → pin the whole conversation to the cheap worker model
 *             (deepseek-v4-pro); classifier + task tree skipped
 *   planner → pin the whole conversation to the frontier planner model
 *             (kimi-k3); classifier + task tree skipped
 */
export type BrainMode = 'auto' | 'worker' | 'planner'

export interface AgentInfo {
  id: string
  name: string
  status: 'running' | 'installed' | 'not-installed' | 'error'
  publisher: string
  version: string
  installPath: string
  port: number | null
  description: string
  tags: string[]
}

export interface AgentState {
  activeAgentId: string | null
  agents: AgentInfo[]
}

export interface SessionEntry {
  id: string
  timestamp: number
  messageCount: number
  preview: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  contextTokens?: number
}

export interface DoneMeta {
  sessionId?: string
  elapsedMs?: number
  apiCalls?: number
  chunks?: number
  completed?: boolean
  model?: string
  provider?: string
  via?: string
}

/** Environment self-check result (src/main/doctor.ts) — shared so the renderer
 *  can render it without importing main-process code. */
export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
  hint?: string
}

export interface DoctorReport {
  ts: number
  ok: boolean
  checks: DoctorCheck[]
}

export interface TaskTreeNode {
  id: string
  title: string
  task: string
  deps: string[]
  /** shared vocabulary — see src/shared/task-state.ts */
  status: TaskPhase
  conditions?: TaskCondition[]
  elapsedMs?: number
  result?: string
  error?: string
}

export interface TaskTree {
  goal: string
  nodes: TaskTreeNode[]
}

// ── Provider presets (shared with setup wizard) ──

export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  models: string[]
  defaultModel: string
  plannerModel: string
  workerModel: string
}

export interface LLMConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
}

export interface BrainSlotConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
}

// ── Onboarding ──

export interface OnboardingState {
  needsSetup: boolean
  existing: { provider?: string; baseURL?: string; model?: string; apiKey?: string }
  providers: ProviderPreset[]
  dismissedAt: number | null
  externalAgents: { id: string; name: string; status: string }[]
}

// ── Skill hub ──

export interface SkillEntry {
  name: string
  version: string
  category: string
  tags: string[]
  description: string
  active: boolean
  activeFor: string[]
  /** #25: declared capabilities — consent-gated on enable */
  capabilities?: string[]
  installedAt?: string
}

export interface CategoryData {
  version: number
  categories: { id: string; icon: string; label: string; subcategories: { id: string; label: string }[] }[]
}

export interface CommunitySkillData {
  name: string
  version: string
  category: string
  tags: string[]
  description: string
  author: string
  stars: number
  repo: string
  raw_url: string
  compatible_agents: string[]
  installed: boolean
  hasUpdate: boolean
  localVersion?: string
}

export interface CommunityResponse {
  ok: boolean
  skills: CommunitySkillData[]
  source: 'github' | 'local' | 'none'
}

export interface GitHubSearchResult {
  ok: boolean
  skills?: { name: string; stars: number; description: string; repo: string }[]
  error?: string
}

// ── VFS ──

export interface VfsFileEntry {
  name: string
  path: string
  size: number
  ext: string
  createdAt: number
}

// ── Habit Engine ──

export type CollectorStateType = 'idle' | 'running' | 'paused' | 'error'

export interface HabitServiceState {
  collector: CollectorStateType
  eventCount: number
  segmentCount: number
  lastSampleAt: number | null
  privacyPaused: boolean
}

export interface HabitEvent {
  id: number
  ts: number
  kind: string
  app: string
  title: string
  url: string
  duration: number
}

export interface HabitCardData {
  id: number
  name: string
  kind: string
  triggerJson: string
  patternJson: string
  confidence: number
  evidenceCount: number
  firstSeen: string
  lastSeen: string
  status: string
  userNote: string
}

// ══════════════════════════════════════════════════════════════════════════
// Channel Maps
// ══════════════════════════════════════════════════════════════════════════

/**
 * Request/Response channels (ipcMain.handle ↔ ipcRenderer.invoke).
 *
 * Shape: { req: [param1: Type1, ...], res: ReturnType }
 *   - req: tuple of parameters (use [] for no params)
 *   - res: return type (use void for fire-and-forget semantics via invoke)
 */
/** P0-4A: session grant record (mirrors main/agents/grants.ts Grant). */
export interface GrantInfo {
  kind: 'always_tool' | 'always_command' | 'always_path'
  tool: string
  command?: string
  path?: string
  createdAt: number
}

/** P0-5: inbox item (mirrors main/inbox.ts InboxItem). */
export interface InboxItemInfo {
  id: string
  kind: 'approval' | 'tree-failed' | 'budget-warning' | 'agent-offline' | 'habit-reminder'
  title: string
  preview: string
  status: 'open' | 'resolved'
  sessionId?: string
  visibility: 'inline' | 'inbox'
  createdAt: number
  data?: any
}

// ── Pet feeding (拖文件/文件夹到桌面宠物 → 自动分析) ──

export interface FeedItem {
  path: string
  name: string
  kind: 'file' | 'folder'
  size: number
  ext: string
  modifiedAt: number
  /** 文件：全文/前 256KB 文本预览；文件夹：目录树文本；二进制/PDF：'' */
  preview: string
}

export interface FeedPayload {
  items: FeedItem[]
  /** 目录树/预览拼接后的摘要文本（agent 第一手资料） */
  summary: string
  /** S2 咀嚼文案，如 "嗷呜～嚼嚼嚼… xxx.md 真香！" */
  statText: string
  /** 触发时宠物窗口 bounds，用于定位新气泡 */
  petBounds: Electron.Rectangle
}

export interface IpcInvokeMap {
  // App info & pet lifecycle
  'get-app-info':     { req: [];                                res: { platform: string; version: string; name: string } }
  'hide-pet':         { req: [];                                res: void }
  'show-pet':         { req: [];                                res: void }
  'pet-bounds':       { req: [];                                res: Electron.Rectangle | null }
  'pet:walk':         { req: [dx: number, durationMs: number];  res: number }
  'pet:click':        { req: [];                                res: void }
  'pet:context-menu': { req: [];                                res: void }
  'pet:edge-toggle':  { req: [];                                res: void }
  'sessions:open':    { req: [sid: string];                     res: void }
  // Pet feeding: 气泡内清单编辑 —— 任意路径集重建 payload / 文件夹拆一层
  'feed:build':       { req: [paths: string[]];                 res: FeedPayload }
  'feed:expand':      { req: [path: string];                    res: FeedItem[] }

  // Creation workspace (phase-1 MVP)
  'create:open':      { req: [p: { source: string; title: string; type: string }]; res: void }
  'create:sub-open':  { req: [kind: string, source: string];   res: void }
  'create:scan':      { req: [dir: string];                     res: { name: string; path: string; isDir: boolean }[] }
  'create:read':      { req: [path: string];                    res: string }
  'create:export':    { req: [p: { title: string; blocks: { kind: string; content: string }[]; format: 'html' | 'pdf' | 'pptx'; dir: string; templateId?: string; themeColor?: string; themeFont?: string }]; res: string }
  'create:payload':   { req: [];                                res: { source: string; title: string; type: string } | null }
  'create:skills':    { req: [];                                res: { templates: { id: string; label: string }[]; elements: { kind: string; label: string; snippet: string }[] } }
  'create:save':      { req: [p: { dir: string; state: { title: string; blocks: { kind: string; content: string; size?: number; color?: string }[]; templateId: string } }]; res: void }
  'create:load':      { req: [dir: string];                     res: any }

  // Settings
  'open-settings':    { req: [];                                res: void }
  'open-pet-customizer': { req: [];                             res: void }
  'custom-pet:save':  { req: [dataUrl: string, sheetDataUrl: string, name: string]; res: CustomPetInfo }
  'custom-pet:remove':{ req: [id: string];                      res: void }
  'custom-pet:list':  { req: [];                                res: CustomPetInfo[] }
  'custom-pet:png-url':   { req: [id: string];                  res: string | null }
  'custom-pet:sheet-url': { req: [id: string];                  res: string | null }
  'custom-pet:classify': { req: [dataUrl: string, nameHint: string]; res: string | null }
  // img2threejs: photo → procedural Three.js (forge pipeline console)
  'img2threejs:open':    { req: [];                                res: void }
  'img2threejs:init':    { req: [reference: string, projectName: string, profile: string]; res: { state: import('./img2threejs-parser').ForgeStepState; projectDir: string } }
  'img2threejs:status':  { req: [projectDir: string];             res: import('./img2threejs-parser').ForgeStepState | null }
  'img2threejs:mark':    { req: [projectDir: string, step: string]; res: import('./img2threejs-parser').ForgeStepState | null }
  'img2threejs:artifacts': { req: [projectDir: string];           res: { name: string; path: string; kind: string }[] }
  'img2threejs:open-artifact': { req: [path: string];             res: void }
  'settings:get':     { req: [];                                res: PetSettings }
  'settings:update':  { req: [updates: Partial<PetSettings>];   res: PetSettings }
  'settings:update-models': { req: [plannerModel: string, workerModel: string]; res: { ok: boolean; plannerModel: string; workerModel: string } }

  // Agent management
  'agents:scan':                 { req: [];                                res: AgentState }
  'agents:get-state':            { req: [];                                res: AgentState }
  'agents:set-active':           { req: [id: string | null];              res: boolean }
  'agents:execute-task':         { req: [task: string, options?: { modelMode?: BrainMode; sessionId?: string }]; res: { success: boolean } }
  'agents:provider-info':        { req: []; res: { provider: string; workerModel: string; plannerModel: string; capabilities: { worker: any; planner: any } } }
  'agents:verify-provider':      { req: []; res: { ok: boolean; latencyMs?: number; model?: string; error?: string } }

  // Memory (P1-B3) — three-tier scoped memory management
  'memory:list':   { req: []; res: any[] }
  'memory:remember': { req: [scope: string, value: string, key?: string]; res: boolean }
  'memory:update': { req: [id: number, value: string]; res: boolean }
  'memory:forget': { req: [id: number]; res: boolean }
  'memory:move':   { req: [id: number, scope: string]; res: boolean }
  'agents:get-install-commands': { req: [];                                res: Record<string, string> }
  'agents:install':              { req: [agentId: string];                res: { success: boolean; error?: string } }

  // Audit & Sessions
  'audit:recent': { req: []; res: any[] }
  // D2 #45: dead-letter ring (unhandled bridge events + IPC throws)
  'deadletter:list': { req: []; res: any[] }
  // D1 #44: update pipeline (#22 revived)
  'pdf:extract': { req: [path: string]; res: string | null }
  // D4 #46: mentions buffer
  'mentions:list': { req: [channel?: string]; res: any[] }
  'mentions:ingest': { req: [m: any]; res: boolean }
  // #23: re-open the LLM provider config card from settings
  'onboarding:open': { req: []; res: boolean }
  'update:check':    { req: []; res: void }
  'update:download': { req: []; res: void }
  'update:install':  { req: []; res: void }
  'update:dismiss':  { req: [version: string]; res: boolean }
  'update:get':      { req: []; res: any }
  'sessions:list':    { req: [];                                res: SessionEntry[] }
  'sessions:delete':  { req: [sid: string];                     res: boolean }
  'sessions:restore': { req: [sid: string];                     res: any }
  // P1-B2 #14: session row actions
  'sessions:rename':  { req: [sid: string, title: string];      res: boolean }
  'sessions:pin':     { req: [sid: string, pinned: boolean];    res: boolean }
  'sessions:archive': { req: [sid: string, archived: boolean];  res: boolean }
  'session:save':     { req: [sid: string, data: any];          res: void }
  'session:load':     { req: [sid: string];                     res: any }
  /** environment self-check — see src/main/doctor.ts */
  'doctor:run':       { req: [];                                res: DoctorReport }

  // P1-B4 #20: cron jobs
  'cron:list':   { req: [];                                    res: any[] }
  'cron:create': { req: [job: any];                            res: any }
  'cron:update': { req: [id: string, patch: any];              res: void }
  'cron:delete': { req: [id: string];                          res: void }

  // Scheduler (P1: 日程/会议/项目/任务 — 独立窗口, 内部库, 预留 CalDAV/EventKit 同步)
  'scheduler:list-events':    { req: [date?: string];                 res: any[] }
  'scheduler:create-event':   { req: [ev: any];                       res: any }
  'scheduler:update-event':   { req: [id: string, patch: any];        res: void }
  'scheduler:delete-event':   { req: [id: string];                    res: void }
  'scheduler:list-projects':  { req: [];                              res: any[] }
  'scheduler:create-project': { req: [p: any];                        res: any }
  'scheduler:update-project': { req: [id: string, patch: any];        res: void }
  'scheduler:delete-project': { req: [id: string];                    res: void }
  'scheduler:list-tasks':     { req: [projectId?: string];            res: any[] }
  'scheduler:create-task':    { req: [task: any];                     res: any }
  'scheduler:update-task':    { req: [id: string, patch: any];        res: void }
  'scheduler:delete-task':    { req: [id: string];                    res: void }
  'scheduler:today':          { req: [];                              res: any }
  // 预留: 与 macOS 日历 (CalDAV/EventKit) 双向同步 — 目前为空实现占位
  'scheduler:sync':           { req: [dir: 'pull' | 'push'];          res: { ok: boolean; synced: number; message?: string } }
  'scheduler:briefing':       { req: [enabled: boolean];               res: { ok: boolean } }
  'scheduler:briefing-state': { req: [];                               res: boolean }
  'screen:perm':              { req: [];                               res: { accessibility: boolean; screen: string } }
  'screen:open-prefs':        { req: [kind: 'accessibility' | 'screen']; res: void }
  'screen:list-apps':         { req: [];                               res: Array<{ name: string; pid: number }> }
  'screen:open':              { req: [name: string];                   res: { ok: boolean; message?: string } }
  'screen:activate':          { req: [name: string];                   res: { ok: boolean; message?: string } }
  'screen:quit':              { req: [name: string];                   res: { ok: boolean; message?: string } }

  // Session grants (P0-4A) — in-memory authorization memory
  'grants:list':        { req: [];                                            res: GrantInfo[] }
  'grants:remove':      { req: [kind: string, tool: string, command?: string, path?: string]; res: boolean }
  'grants:clear':       { req: [];                                            res: void }
  'grants:check-input': { req: [categories: string[]];                        res: boolean }
  'grants:add-input':   { req: [categories: string[]];                        res: boolean }
  'grants:add':         { req: [kind: string, tool: string, command?: string, path?: string]; res: boolean }

  // Permission gate (Phase 6) — user's decision for a bridge approval card
  // #12: 'turn' = allow every time this turn (main-side auto-answer); command required for it
  'agents:permission-response': { req: [id: string, outcome: 'once' | 'session' | 'always' | 'deny' | 'turn', command?: string]; res: boolean }
  // P2-C2 #33: ask_user question cards
  'agents:question-response': { req: [id: string, answer: string]; res: boolean }
  // P2-C2 #35: task-tree plan confirmation
  'agents:plan-confirm': { req: [ok: boolean]; res: boolean }

  // Inbox (P0-5) — durable unread item queue
  'inbox:list':    { req: [];                              res: InboxItemInfo[] }
  'inbox:count':   { req: [];                              res: number }
  'inbox:resolve': { req: [id: string, by?: string];       res: boolean }
  // P2-C1 #29: secrets (names only across IPC)
  'secrets:list':   { req: []; res: string[] }
  'secrets:set':    { req: [name: string, value: string]; res: boolean }
  'secrets:delete': { req: [name: string]; res: boolean }
  // P2-C1 #30: workspace trust list (recording + status; enforcement lands with #31)
  'trust:list':  { req: []; res: string[] }
  'trust:add':   { req: [dir: string]; res: boolean }
  'trust:remove':{ req: [dir: string]; res: boolean }
  'trust:status':{ req: []; res: { dir: string; trusted: boolean } }
  // P2-C3 #26: persona manifests
  'persona:list':   { req: []; res: { personas: any[]; activeId: string | null } }
  'persona:save':   { req: [p: any]; res: any }
  'persona:delete': { req: [id: string]; res: boolean }
  'persona:active': { req: [id: string | null]; res: boolean }
  // P2-C3 #28: MCP server status (read-only, parsed from ~/.hermes/config.yaml)
  'mcp:status': { req: []; res: { servers: { name: string; transport: string }[]; configPath: string } }

  // Onboarding
  'onboarding:get-state': { req: []; res: OnboardingState }
  'onboarding:dismiss':   { req: []; res: { ok: boolean } }

  // Settings brain config
  'settings:get-brain-config': { req: []; res: { planner: { provider: string; model: string; baseURL: string }; worker: { provider: string; model: string; baseURL: string } } }

  // Setup
  'setup:test':       { req: [config: LLMConfig];                          res: { success: boolean; message: string } }
  'setup:save':       { req: [config: LLMConfig, providerId: string];      res: { ok: boolean } }
  'setup:save-brain': { req: [planner: BrainSlotConfig, worker: BrainSlotConfig]; res: { ok: boolean } }

  // VFS
  'vfs:list':           { req: [];                        res: VfsFileEntry[] }
  'vfs:workspace':      { req: [];                        res: string }
  'vfs:import':         { req: [path: string];            res: string }
  'vfs:read':           { req: [name: string];            res: string | null }
  'vfs:open':         { req: [name: string];           res: void }
  'vfs:reveal':       { req: [name: string];           res: void }
  // P2-C2 #31: multi-root vfs (root[0] = default workspace, writes stay there)
  'vfs:list-roots':   { req: [];                       res: string[] }
  'vfs:add-root':     { req: [dir: string];            res: boolean }
  'vfs:remove-root':  { req: [dir: string];            res: boolean }
  'file-explorer:open': { req: [];                        res: void }

  // Agent stats
  'agent-stats':                { req: [];                                                  res: any }
  'agent-stats:track-tool':     { req: [name: string, ok: boolean, dur: number];            res: void }
  'agent-stats:track-error':    { req: [pattern: string, suggestion: string];               res: void }
  'agent-stats:track-attempt':  { req: [task: string, attempt: number, approach: string, ok: boolean]; res: void }
  'agent-stats:track-context':  { req: [id: string, desc: string];                          res: void }
  'agent-stats:track-decision': { req: [target: string, prediction: string, actual: string, verified: boolean]; res: void }
  'agent-stats:score':          { req: [name: string, score: number, max: number];          res: void }

  // Skill Hub
  'skills:list':               { req: [];                                                                                          res: SkillEntry[] }
  'skills:get':                { req: [name: string];                                                                              res: any }
  'skills:install':            { req: [skill: unknown];                                                                            res: boolean }
  'skills:remove':             { req: [name: string];                                                                              res: boolean }
  'skills:set-active':         { req: [name: string, active: boolean, agent?: string];                                             res: boolean }
  'skills:sync-hermes':        { req: [];                                                                                          res: { synced: number; failed: string[] } }
  'skills:sync-claude':        { req: [];                                                                                          res: any }
  'skills:sync-cursor':        { req: [];                                                                                          res: any }
  'skills:sync-codex':         { req: [];                                                                                          res: any }
  'skills:sync-openclaw':      { req: [];                                                                                          res: any }
  'skills:count':              { req: [];                                                                                          res: number }
  'skills:categories':         { req: [];                                                                                          res: CategoryData }
  'skills:discover':           { req: [];                                                                                          res: any[] }
  'skills:community-registry': { req: [];                                                                                          res: { version: number; skills: any[] } }
  'skills:refresh-community':  { req: [];                                                                                          res: CommunityResponse }
  'skills:search-github':      { req: [];                                                                                          res: GitHubSearchResult }
  'skills:install-remote':     { req: [rawUrl: string, name: string, category: string];                                            res: { ok: boolean; name?: string; error?: string } }

  // Habit Engine — queries
  'habit:state':       { req: [];                                                        res: HabitServiceState }
  'habit:events':      { req: [limit?: number];                                          res: HabitEvent[] }
  'habit:habits':      { req: [];                                                        res: HabitCardData[] }
  'habit:segments':    { req: [date: string];                                            res: any[] }
  'habit:pause':       { req: [];                                                        res: void }
  'habit:resume':      { req: [];                                                        res: void }

  // Habit Engine — actions
  'habit:briefing':      { req: [];                                                      res: { greeting: string; yesterdaySummary: string; todayRoutines: any[]; pendingSuggestions: string[]; tip: string } }
  'habit:context-text':  { req: [userMessage?: string, currentApp?: string];             res: string }
  'habit:deviations':    { req: [currentApp?: string];                                   res: any[] }
  'habit:confirm':       { req: [id: number];                                            res: void }
  'habit:dismiss':       { req: [id: number];                                            res: void }
  'habit:activate':      { req: [id: number];                                            res: void }
  'habit:extract':       { req: [];                                                      res: { newHabits: number; totalCandidates: number } }
  'habit:automation':    { req: [];                                                      res: { workflows: any[]; proposals: any[] } }
  'habit:run-pipeline':  { req: [];                                                      res: { summary: string | null; mode: string; newHabits: number; totalCandidates: number; maintenance: string } }
  'habit:score':         { req: [];                                                      res: number }
  'habit:execute':       { req: [id: number];                                            res: { ok: boolean; opened: string[]; error?: string } }
  'habit:weekly-report': { req: [];                                                      res: { text: string; date: string } | null }
  'habit:score-insight': { req: [];                                                      res: { score: number; insight: string; source: 'llm' | 'local' } }
  'habit:run-weekly':    { req: [];                                                      res: any }

  // Habit Engine — privacy & data
  'habit:enabled':            { req: [];                                                 res: boolean }
  'habit:set-enabled':        { req: [enabled: boolean];                                 res: void }
  'habit:ai-summary-enabled': { req: [];                                                 res: boolean }
  'habit:set-ai-summary':     { req: [enabled: boolean];                                 res: void }
  'habit:export':             { req: [];                                                 res: string }
  'habit:delete-all':         { req: [];                                                 res: void }

  // Voice
  'voice:asr':        { req: [audioBase64: string];          res: string }
  'voice:tts':        { req: [text: string, id: string];     res: boolean }
  'voice:stop':       { req: [];                             res: void }
  'voice:interrupt':  { req: [];                             res: void }
  'voice:start':      { req: [];                             res: boolean }

  // Generative UI
  'genui:list-specs':     { req: [];                               res: import('./gen-ui-types').WindowSpec[] }
  'genui:list-statuses':  { req: [];                               res: import('./gen-ui-types').SpecStatus[] }
  'genui:run-spec':       { req: [id: string];                     res: { ok: boolean; jobId?: string; error?: string } }
  'genui:stop-spec':      { req: [id: string];                     res: { ok: boolean; error?: string } }
  'genui:save-spec':      { req: [spec: any];                      res: { ok: boolean; error?: string } }
  'genui:remove-spec':    { req: [id: string];                     res: { ok: boolean } }
  'genui:modify-spec':    { req: [id: string, instruction: string]; res: any }
  'genui:get-webhook':    { req: [];                               res: string }
  'genui:set-webhook':    { req: [url: string];                    res: void }
  'genui:pulled-out':     { req: [];                               res: string[] },
  'genui:open-path':      { req: [path: string];                   res: void }
  'detail:get':           { req: [];                               res: { title: string; content: string } | null }
}

/**
 * Fire-and-forget channels (ipcMain.on ↔ ipcRenderer.send).
 * Renderer → Main, one-way, no response.
 *
 * Shape: [param1: Type1, param2: Type2, ...]
 */
export interface IpcSendMap {
  'drag-start':       [x: number, y: number]
  'drag-move':        [dx: number, dy: number]
  'drag-end':         []
  // Pet feeding: hit window hover/drop → main (fire-and-forget)
  'pet:feed-hover':   []
  'pet:feed-leave':   []
  'pet:feed':         [paths: string[]]
  'bubble:resize':    [height: number]
  'bubble:minimize':  []
  'bubble:maximize':  []
  'bubble:close':     []
  'agents:abort':     []
  'renderer:log':     [level: string, ...args: any[]]
  'genui:open':       []
  'genui:open-card':  [specId?: string]
  'genui:focus-spec': [id: string]
  'genui:name-draft': [title: string]
  'genui:open-path':  [path: string]
  'win:drag-start':   []
  'win:drag-end':     []
  'card:minimize':    []
  'card:stop-close':  []
  'card:resize':      [w: number, h: number]
  'detail:open':      [title: string, content: string]
  'dock:minimize':    []
  'dock:close':       []
  'dock:maximize':    []
  'create:win-min':   []
  'create:win-max':   []
  'create:win-close': []
  'create:state-changed': []
}

/**
 * Main → Renderer push channels (webContents.send ↔ ipcRenderer.on).
 * Server-push events: streaming output, state change notifications, etc.
 *
 * Shape: [param1: Type1, param2: Type2, ...]
 */
export interface IpcPushMap {
  'task:chunk':           [text: string]
  'task:queued':          [queueLen: number]
  'task:done':            [sessionId?: string]
  'task:error':           [error: string]
  'session:restore':      [sid: string]
  'create:refresh':       []
  // Pet feeding: main drives the pet's speech bubble / kicks off auto-analysis
  'pet:say':              [text: string, ms: number]
  'feed:analyze':         [payload: FeedPayload]
  'reasoning:chunk':      [text: string]
  'reasoning:end':        []
  'tool:call':            [name: string, args: string]
  'tool:result':          [name: string, content: string]
  'token:usage':          [usage: TokenUsage]
  'turn:done-meta':       [meta: DoneMeta]
  'turn:start-meta':      [meta: { model?: string }]
  'tree:update':          [tree: TaskTree]
  'agent-state-changed':  [state: AgentState]
  'settings-changed':     [settings: PetSettings]
  'agent:event':          [event: import('./agent-events').AgentEvent]
  /** P0-2a: graceful interrupt — partial answer already streamed; renderer
   *  must finalize streaming state (this replaced onError('Task aborted')). */
  'task:interrupted':     [partialText: string]
  /** P0-5: inbox open-count changed (pet badge / panel refresh) */
  'inbox:changed':        [openCount: number]
  // Phase 6: approval card lifecycle pushes (permission.required also flows
  // via agent:event; these legacy channels drive the ApprovalCard directly)
  'permission:required':  [req: { id: string; command: string; description: string; allowPermanent: boolean; smartDenied: boolean }]
  'permission:resolved':  [info: { id: string; reason: 'timeout' | 'abort' | 'responded' }]
  // #33: ask_user question cards
  'question:required':    [req: { id: string; question: string; choices: string[] }]
  'question:resolved':    [info: { id: string; reason: 'timeout' | 'abort' | 'responded' }]
  // #44: update status broadcast
  'update:status':        [status: any]
  // #23: ask the bubble window to re-open its onboarding card
  'onboarding:show':      []
  /** Mouse proximity relative to pet window center: {near, dx, dy} */
  'pet:mouse':            [{ near: boolean; dx: number; dy: number }]
  // #35: task-tree plan awaiting user confirmation
  'plan:proposed':        [info: { tree: any }]
  // Voice
  'voice:asr-result':     [text: string]
  'voice:tts-ready':      [id: string, path: string]
  'voice:tts-error':      [id: string, message: string]
  'voice:speaking':       [active: boolean]
  'voice:interrupt':      []
  'voice:emotion':        [emotion: string]
  // Generative UI
  'genui:spec-changed':   [spec: import('./gen-ui-types').WindowSpec]
  'genui:spec-removed':   [id: string]
  'genui:status-changed': [status: import('./gen-ui-types').SpecStatus]
  'genui:card-bind':      [specId: string]
  'genui:deck-hide':      [ids: string[]]
  'genui:edit-spec':      [info: { id: string; title: string } | null]
}
