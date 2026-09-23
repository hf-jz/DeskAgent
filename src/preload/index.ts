import { contextBridge, ipcRenderer, webUtils, clipboard, type IpcRendererEvent } from 'electron'
import type { IpcInvokeMap, IpcSendMap, IpcPushMap } from '../shared/ipc-channels'

// SANDBOX CONSTRAINT: windows run with sandbox: true, so preload scripts may
// only require('electron') — a runtime import of a local module (e.g.
// ../shared/ipc-renderer) throws at load time, contextBridge never runs, and
// window.deskAppAPI is undefined in the renderer. The typed IPC helpers are
// therefore INLINED here; type contracts stay shared via the type-only import
// above (erased at compile time).
function invokeIPC<K extends keyof IpcInvokeMap>(
  channel: K,
  ...args: IpcInvokeMap[K]['req']
): Promise<IpcInvokeMap[K]['res']> {
  return ipcRenderer.invoke(channel as string, ...args) as Promise<IpcInvokeMap[K]['res']>
}

function sendIPC<K extends keyof IpcSendMap>(
  channel: K,
  ...args: IpcSendMap[K]
): void {
  ipcRenderer.send(channel as string, ...args)
}

function onPush<K extends keyof IpcPushMap>(
  channel: K,
  callback: (...args: IpcPushMap[K]) => void
): () => void {
  const handler = (_e: IpcRendererEvent, ...args: IpcPushMap[K]) => {
    callback(...args)
  }
  ipcRenderer.on(channel as string, handler)
  return () => {
    ipcRenderer.removeListener(channel as string, handler)
  }
}

// Shared domain types are now in src/shared/ipc-channels.ts
// DeskAppAPI is auto-exported below for the renderer's types.d.ts reference.

// Settings > Sessions restore: the main sends session:restore possibly
// before the renderer mounts — buffer here, the renderer pulls it at mount.
let pendingRestore: string | null = null
onPush('session:restore', (sid: string) => { pendingRestore = sid })

// Pet feeding: feed:analyze 可能早于 React effect 注册监听到达 ——
// 缓冲，BubbleApp mount 后 takeFeed() 拉取（与 pendingRestore 同模式）。
let pendingFeed: import('../shared/ipc-channels').FeedPayload | null = null
onPush('feed:analyze', (payload: import('../shared/ipc-channels').FeedPayload) => { pendingFeed = payload })

const deskAppAPI = {
  // App info
  getAppInfo:    (): Promise<{ platform: string; version: string; name: string }> => invokeIPC('get-app-info'),
  hidePet:       (): Promise<void> => invokeIPC('hide-pet'),
  showPet:       (): Promise<void> => invokeIPC('show-pet'),
  getPetBounds:  (): Promise<Electron.Rectangle | null> => invokeIPC('pet-bounds'),
  walkPet:       (dx: number, durationMs: number): Promise<number> => invokeIPC('pet:walk', dx, durationMs),

  // Pet interaction
  openPet:       (): Promise<void> => invokeIPC('pet:click'),
  showContextMenu: (): Promise<void> => invokeIPC('pet:context-menu'),

  // Drag (fire-and-forget)
  sendDragStart: (x: number, y: number): void => sendIPC('drag-start', x, y),
  sendDragMove:  (dx: number, dy: number): void => sendIPC('drag-move', dx, dy),
  sendDragEnd:   (): void => sendIPC('drag-end'),
  // Pet feeding: hit window → main
  feedHover:     (): void => sendIPC('pet:feed-hover'),
  feedLeave:     (): void => sendIPC('pet:feed-leave'),
  sendFeed:      (paths: string[]): void => sendIPC('pet:feed', paths),
  // 气泡内清单编辑
  buildFeed:     (paths: string[]): Promise<import('../shared/ipc-channels').FeedPayload> => invokeIPC('feed:build', paths),
  expandFeed:    (path: string): Promise<import('../shared/ipc-channels').FeedItem[]> => invokeIPC('feed:expand', path),
  // Main → renderer: pet speech bubble + auto-analysis kickoff
  onPetSay:      (callback: (text: string, ms: number) => void): (() => void) => onPush('pet:say', callback),
  onFeedAnalyze: (callback: (payload: import('../shared/ipc-channels').FeedPayload) => void): (() => void) => onPush('feed:analyze', callback),
  // Generic frameless-window drag (dock/card): main polls the cursor
  dragWindowStart: (): void => sendIPC('win:drag-start'),
  dragWindowEnd:   (): void => sendIPC('win:drag-end'),
  // Card window macOS-style buttons
  cardMinimize:    (): void => sendIPC('card:minimize'),
  cardCloseAndStop:(): void => sendIPC('card:stop-close'),
  cardResize:      (w: number, h: number): void => sendIPC('card:resize', w, h),
  detailOpen:      (title: string, content: string): void => sendIPC('detail:open', title, content),
  detailGet:       (): Promise<any> => invokeIPC('detail:get'),
  dockMinimize:    (): void => sendIPC('dock:minimize'),
  dockClose:       (): void => sendIPC('dock:close'),
  dockMaximize:    (): void => sendIPC('dock:maximize'),
  createWinMinimize: (): void => sendIPC('create:win-min'),
  createWinMaximize: (): void => sendIPC('create:win-max'),
  createWinClose:    (): void => sendIPC('create:win-close'),
  notifyCreateStateChanged: (): void => sendIPC('create:state-changed'),
  onCreateRefresh:   (cb: () => void): (() => void) => onPush('create:refresh', cb),

  // Clipboard via Electron (works without renderer focus / clipboard-write permission)
  writeClipboard: (text: string): void => clipboard.writeText(text),
  // Settings
  openSettings:    (): Promise<void> => invokeIPC('open-settings'),
  // Scheduler: 日程/会议/项目/任务（独立窗口）
  scheduler: {
    listEvents:     (date?: string): Promise<any[]> => invokeIPC('scheduler:list-events', date),
    createEvent:    (ev: any): Promise<any> => invokeIPC('scheduler:create-event', ev),
    updateEvent:    (id: string, patch: any): Promise<void> => invokeIPC('scheduler:update-event', id, patch),
    deleteEvent:    (id: string): Promise<void> => invokeIPC('scheduler:delete-event', id),
    listProjects:   (): Promise<any[]> => invokeIPC('scheduler:list-projects'),
    createProject:  (p: any): Promise<any> => invokeIPC('scheduler:create-project', p),
    updateProject:  (id: string, patch: any): Promise<void> => invokeIPC('scheduler:update-project', id, patch),
    deleteProject:  (id: string): Promise<void> => invokeIPC('scheduler:delete-project', id),
    listTasks:      (projectId?: string): Promise<any[]> => invokeIPC('scheduler:list-tasks', projectId),
    createTask:     (task: any): Promise<any> => invokeIPC('scheduler:create-task', task),
    updateTask:     (id: string, patch: any): Promise<void> => invokeIPC('scheduler:update-task', id, patch),
    deleteTask:     (id: string): Promise<void> => invokeIPC('scheduler:delete-task', id),
    today:          (): Promise<any> => invokeIPC('scheduler:today'),
    sync:           (dir: 'pull' | 'push'): Promise<{ ok: boolean; synced: number; message?: string }> => invokeIPC('scheduler:sync', dir),
    setBriefing:    (enabled: boolean): Promise<{ ok: boolean }> => invokeIPC('scheduler:briefing', enabled),
    briefingState:  (): Promise<boolean> => invokeIPC('scheduler:briefing-state'),
  },
  // 屏幕操控（L1 原生桥 + 权限检测；L2 由 agent 的 computer_use 工具承担）
  screen: {
    perm:        (): Promise<{ accessibility: boolean; screen: string }> => invokeIPC('screen:perm'),
    openPrefs:   (kind: 'accessibility' | 'screen'): Promise<void> => invokeIPC('screen:open-prefs', kind),
    listApps:    (): Promise<Array<{ name: string; pid: number }>> => invokeIPC('screen:list-apps'),
    open:        (name: string): Promise<{ ok: boolean; message?: string }> => invokeIPC('screen:open', name),
    activate:    (name: string): Promise<{ ok: boolean; message?: string }> => invokeIPC('screen:activate', name),
    quit:        (name: string): Promise<{ ok: boolean; message?: string }> => invokeIPC('screen:quit', name),
  },
  openPetCustomizer: (): Promise<void> => invokeIPC('open-pet-customizer'),
  saveCustomPet:   (dataUrl: string, sheetDataUrl: string, name: string): Promise<import('../shared/ipc-channels').CustomPetInfo> => invokeIPC('custom-pet:save', dataUrl, sheetDataUrl, name),
  removeCustomPet: (id: string): Promise<void> => invokeIPC('custom-pet:remove', id),
  listCustomPets:  (): Promise<import('../shared/ipc-channels').CustomPetInfo[]> => invokeIPC('custom-pet:list'),
  getCustomPetPngUrl: (id: string): Promise<string | null> => invokeIPC('custom-pet:png-url', id),
  getCustomPetSheetUrl: (id: string): Promise<string | null> => invokeIPC('custom-pet:sheet-url', id),
  classifyCustomPet: (dataUrl: string, nameHint: string): Promise<string | null> => invokeIPC('custom-pet:classify', dataUrl, nameHint),
  onPetMouse:      (callback: (m: { near: boolean; dx: number; dy: number }) => void): (() => void) =>
    onPush('pet:mouse', callback),
  // img2threejs forge console
  openImg2ThreeJs: (): Promise<void> => invokeIPC('img2threejs:open'),
  img2ThreeJsInit: (reference: string, projectName: string, profile?: string): Promise<{ state: import('../shared/img2threejs-parser').ForgeStepState; projectDir: string }> => invokeIPC('img2threejs:init', reference, projectName, profile || 'generic'),
  img2ThreeJsStatus: (projectDir: string): Promise<import('../shared/img2threejs-parser').ForgeStepState | null> => invokeIPC('img2threejs:status', projectDir),
  img2ThreeJsMark: (projectDir: string, step: string): Promise<import('../shared/img2threejs-parser').ForgeStepState | null> => invokeIPC('img2threejs:mark', projectDir, step),
  img2ThreeJsArtifacts: (projectDir: string): Promise<{ name: string; path: string; kind: string }[]> => invokeIPC('img2threejs:artifacts', projectDir),
  img2ThreeJsOpenArtifact: (path: string): Promise<void> => invokeIPC('img2threejs:open-artifact', path),
  getSettings:     (): Promise<import('../shared/ipc-channels').PetSettings> => invokeIPC('settings:get'),
  updateSettings:  (updates: Partial<import('../shared/ipc-channels').PetSettings>): Promise<import('../shared/ipc-channels').PetSettings> => invokeIPC('settings:update', updates),
  onSettingsChanged: (callback: (s: import('../shared/ipc-channels').PetSettings) => void): (() => void) =>
    onPush('settings-changed', callback),

  // ── Task events (Main→Renderer push) ──
  onTaskChunk:  (callback: (text: string) => void): (() => void) =>
    onPush('task:chunk', (text) => { try { callback(text) } catch (err) { console.error('onTaskChunk error:', err) } }),
  onTaskQueued: (callback: (queueLen: number) => void): (() => void) =>
    onPush('task:queued', callback),
  onTaskDone:   (callback: (sessionId?: string) => void): (() => void) =>
    onPush('task:done', callback),
  onTaskError:  (callback: (error: string) => void): (() => void) =>
    onPush('task:error', callback),

  // Reasoning + Tool events
  onReasoningChunk: (callback: (text: string) => void): (() => void) =>
    onPush('reasoning:chunk', callback),
  /** thinking block closed — explicit boundary from the bridge (no guessing) */
  onReasoningEnd: (callback: () => void): (() => void) =>
    onPush('reasoning:end', callback),
  onToolCall:       (callback: (name: string, args: string) => void): (() => void) =>
    onPush('tool:call', callback),
  onToolResult:     (callback: (name: string, content: string) => void): (() => void) =>
    onPush('tool:result', callback),

  // Token usage + turn metadata
  onTokenUsage:   (callback: (usage: import('../shared/ipc-channels').TokenUsage) => void): (() => void) =>
    onPush('token:usage', callback),
  onTurnDoneMeta: (callback: (meta: import('../shared/ipc-channels').DoneMeta) => void): (() => void) =>
    onPush('turn:done-meta', callback),
  onTurnStartMeta: (callback: (meta: { model?: string }) => void): (() => void) =>
    onPush('turn:start-meta', callback),

  // Task-tree orchestration
  onTreeUpdate: (callback: (tree: import('../shared/ipc-channels').TaskTree) => void): (() => void) =>
    onPush('tree:update', callback),

  // Agent state push
  onAgentStateChanged: (callback: (state: import('../shared/ipc-channels').AgentState) => void): (() => void) =>
    onPush('agent-state-changed', callback),

  // ── Unified agent event stream (P0-1) ──
  onAgentEvent: (callback: (event: import('../shared/ipc-channels').IpcPushMap['agent:event'][0]) => void): (() => void) =>
    onPush('agent:event', callback),

  // ── Graceful interrupt (P0-2a) ──
  onTaskInterrupted: (callback: (partialText: string) => void): (() => void) =>
    onPush('task:interrupted', callback),

  // P0-5: inbox open-count push (pet badge / bubble panel)
  onInboxChanged: (callback: (openCount: number) => void): (() => void) =>
    onPush('inbox:changed', callback),

  // Phase 6: approval card lifecycle
  respondPermission: (id: string, outcome: 'once' | 'session' | 'always' | 'deny' | 'turn', command?: string): Promise<boolean> =>
    invokeIPC('agents:permission-response', id, outcome, command),
  onPermissionRequired: (callback: (req: { id: string; command: string; description: string; allowPermanent: boolean; smartDenied: boolean }) => void): (() => void) =>
    onPush('permission:required', callback),
  onPermissionResolved: (callback: (info: { id: string; reason: 'timeout' | 'abort' | 'responded' }) => void): (() => void) =>
    onPush('permission:resolved', callback),
  // #33: ask_user question cards
  onQuestionRequired: (callback: (req: any) => void): (() => void) =>
    onPush('question:required', callback),
  onQuestionResolved: (callback: (info: { id: string; reason: string }) => void): (() => void) =>
    onPush('question:resolved', callback),
  respondQuestion: (id: string, answer: string): Promise<boolean> =>
    invokeIPC('agents:question-response', id, answer),
  // #35: task-tree plan confirmation
  onPlanProposed: (callback: (info: { tree: any }) => void): (() => void) =>
    onPush('plan:proposed', callback),
  confirmPlan: (ok: boolean): Promise<boolean> => invokeIPC('agents:plan-confirm', ok),

  // ── Agents ──
  scanAgents:       (): Promise<import('../shared/ipc-channels').AgentState> => invokeIPC('agents:scan'),
  getAgentState:    (): Promise<import('../shared/ipc-channels').AgentState> => invokeIPC('agents:get-state'),
  setActiveAgent:   (id: string | null): Promise<boolean> => invokeIPC('agents:set-active', id),
  executeTask:      (task: string, options?: { modelMode?: import('../shared/ipc-channels').BrainMode; sessionId?: string }): Promise<{ success: boolean }> => invokeIPC('agents:execute-task', task, options),
  // P1-B3 #23: provider info & verification
  getProviderInfo: (): Promise<{ provider: string; workerModel: string; plannerModel: string; capabilities: { worker: any; planner: any } }> => invokeIPC('agents:provider-info'),
  verifyProvider: (): Promise<{ ok: boolean; latencyMs?: number; model?: string; error?: string }> => invokeIPC('agents:verify-provider'),
  updateModels:   (plannerModel: string, workerModel: string): Promise<{ ok: boolean; plannerModel: string; workerModel: string }> => invokeIPC('settings:update-models', plannerModel, workerModel),
  getBrainConfig: (): Promise<{ planner: { provider: string; model: string; baseURL: string }; worker: { provider: string; model: string; baseURL: string } }> => invokeIPC('settings:get-brain-config'),
  abortTask:        (): void => sendIPC('agents:abort'),
  openBubble:       (): Promise<void> => invokeIPC('pet:click'), // fixed: was send→handle mismatch
  openSession:      (sid: string): Promise<void> => invokeIPC('sessions:open', sid),
  openCreate:       (p: { source: string; title: string; type: string }): Promise<void> => invokeIPC('create:open', p),
  openCreateSub:    (kind: string, source: string): Promise<void> => invokeIPC('create:sub-open', kind, source),
  scanCreateDir:    (dir: string): Promise<{ name: string; path: string; isDir: boolean }[]> => invokeIPC('create:scan', dir),
  readCreateFile:   (path: string): Promise<string> => invokeIPC('create:read', path),
  exportCreate:     (p: { title: string; blocks: { kind: string; content: string }[]; format: 'html' | 'pdf' | 'pptx'; dir: string; templateId?: string; themeColor?: string; themeFont?: string }): Promise<string> => invokeIPC('create:export', p),
  getCreatePayload: (): Promise<{ source: string; title: string; type: string } | null> => invokeIPC('create:payload'),
  getCreateSkills:  (): Promise<{ templates: { id: string; label: string }[]; elements: { kind: string; label: string; snippet: string }[] }> => invokeIPC('create:skills'),
  saveCreateState:  (p: { dir: string; state: any }): Promise<void> => invokeIPC('create:save', p),
  loadCreateState:  (dir: string): Promise<any> => invokeIPC('create:load', dir),
  takeRestore:      (): string | null => {
    const s = pendingRestore; pendingRestore = null; return s
  },
  takeFeed:         (): import('../shared/ipc-channels').FeedPayload | null => {
    const p = pendingFeed; pendingFeed = null; return p
  },
  getInstallCommands: (): Promise<Record<string, string>> => invokeIPC('agents:get-install-commands'),
  getAuditLog:     (): Promise<any[]> => invokeIPC('audit:recent'),
  listDeadLetters: (): Promise<any[]> => invokeIPC('deadletter:list'),
  /** environment self-check (python / bundle / key / disk / memory) */
  runDoctor: (): Promise<import('../shared/ipc-channels').DoctorReport> => invokeIPC('doctor:run'),
  // #48: PDF → text
  extractPdf: (path: string): Promise<string | null> => invokeIPC('pdf:extract', path),
  // #23: reopen LLM provider card
  openOnboarding: (): Promise<boolean> => invokeIPC('onboarding:open'),
  onOnboardingShow: (callback: () => void): (() => void) =>
    onPush('onboarding:show', callback),
  // #44: updates
  checkUpdate:     (): Promise<void> => invokeIPC('update:check'),
  downloadUpdate:  (): Promise<void> => invokeIPC('update:download'),
  installUpdate:   (): Promise<void> => invokeIPC('update:install'),
  dismissUpdate:   (version: string): Promise<boolean> => invokeIPC('update:dismiss', version),
  getUpdateStatus: (): Promise<any> => invokeIPC('update:get'),
  onUpdateStatus: (callback: (status: any) => void): (() => void) =>
    onPush('update:status', callback),
  // P2-C1 #29: secrets
  listSecrets:      (): Promise<string[]> => invokeIPC('secrets:list'),
  setSecret:        (name: string, value: string): Promise<boolean> => invokeIPC('secrets:set', name, value),
  deleteSecret:     (name: string): Promise<boolean> => invokeIPC('secrets:delete', name),
  // P2-C1 #30: workspace trust
  listTrusted:      (): Promise<string[]> => invokeIPC('trust:list'),
  trustDir:         (dir: string): Promise<boolean> => invokeIPC('trust:add', dir),
  untrustDir:       (dir: string): Promise<boolean> => invokeIPC('trust:remove', dir),
  trustStatus:      (): Promise<{ dir: string; trusted: boolean }> => invokeIPC('trust:status'),
  // P0-4A: session grants
  listGrants:       (): Promise<import('../shared/ipc-channels').GrantInfo[]> => invokeIPC('grants:list'),
  removeGrant:      (kind: string, tool: string, command?: string, path?: string): Promise<boolean> => invokeIPC('grants:remove', kind, tool, command, path),
  clearGrants:      (): Promise<void> => invokeIPC('grants:clear'),
  checkInputGrant:  (categories: string[]): Promise<boolean> => invokeIPC('grants:check-input', categories),
  addInputGrant:    (categories: string[]): Promise<boolean> => invokeIPC('grants:add-input', categories),
  addGrant:         (kind: string, tool: string, command?: string, path?: string): Promise<boolean> =>
    invokeIPC('grants:add', kind, tool, command, path),
  // P1-B3 #16: three-tier memory management
  listMemory:   (): Promise<any[]> => invokeIPC('memory:list'),
  addMemory:    (scope: string, value: string, key?: string): Promise<boolean> => invokeIPC('memory:remember', scope, value, key),
  updateMemory: (id: number, value: string): Promise<boolean> => invokeIPC('memory:update', id, value),
  forgetMemory: (id: number): Promise<boolean> => invokeIPC('memory:forget', id),
  moveMemory:   (id: number, scope: string): Promise<boolean> => invokeIPC('memory:move', id, scope),
  // P0-5: inbox
  listInbox:        (): Promise<import('../shared/ipc-channels').InboxItemInfo[]> => invokeIPC('inbox:list'),
  getInboxCount:    (): Promise<number> => invokeIPC('inbox:count'),
  resolveInboxItem: (id: string, by?: string): Promise<boolean> => invokeIPC('inbox:resolve', id, by),
  listSessions:     (): Promise<import('../shared/ipc-channels').SessionEntry[]> => invokeIPC('sessions:list'),
  renameSession:    (sid: string, title: string): Promise<boolean> => invokeIPC('sessions:rename', sid, title),
  pinSession:       (sid: string, pinned: boolean): Promise<boolean> => invokeIPC('sessions:pin', sid, pinned),
  archiveSession:   (sid: string, archived: boolean): Promise<boolean> => invokeIPC('sessions:archive', sid, archived),
  deleteSession:    (sid: string): Promise<boolean> => invokeIPC('sessions:delete', sid),
  restoreSession:   (sid: string): Promise<any> => invokeIPC('sessions:restore', sid),
  installAgent:     (agentId: string): Promise<{ success: boolean; error?: string }> => invokeIPC('agents:install', agentId),

  // ── Conversational onboarding ──
  getOnboardingState: (): Promise<import('../shared/ipc-channels').OnboardingState> => invokeIPC('onboarding:get-state'),
  dismissOnboarding:  (): Promise<{ ok: boolean }> => invokeIPC('onboarding:dismiss'),
  testLLMConnection: (config: import('../shared/ipc-channels').LLMConfig): Promise<{ success: boolean; message: string }> => invokeIPC('setup:test', config),
  saveLLMConfig:    (config: import('../shared/ipc-channels').LLMConfig, providerId: string): Promise<{ ok: boolean }> => invokeIPC('setup:save', config, providerId),
  saveBrainConfig:  (planner: import('../shared/ipc-channels').BrainSlotConfig, worker: import('../shared/ipc-channels').BrainSlotConfig): Promise<{ ok: boolean; errors?: string[] }> => invokeIPC('setup:save-brain', planner, worker),

  // Bubble window controls (fire-and-forget)
  resizeBubble:   (height: number): void => sendIPC('bubble:resize', height),
  minimizeBubble: (): void => sendIPC('bubble:minimize'),
  maximizeBubble: (): void => sendIPC('bubble:maximize'),
  closeBubble:    (): void => sendIPC('bubble:close'),

  // ── VFS ──
  getVfsFiles:     (): Promise<import('../shared/ipc-channels').VfsFileEntry[]> => invokeIPC('vfs:list'),
  getWorkspaceDir: (): Promise<string> => invokeIPC('vfs:workspace'),
  vfsImport:       (path: string): Promise<string> => invokeIPC('vfs:import', path),
  // P1-B1 #11: resolve a dropped/pasted File to an absolute path (Electron 39 webUtils)
  getFilePath:     (file: File): string => webUtils.getPathForFile(file),
  readVfsFile:     (name: string): Promise<string | null> => invokeIPC('vfs:read', name),
  openVfsFile:     (name: string): Promise<void> => invokeIPC('vfs:open', name),
  revealVfsFile:   (name: string): Promise<void> => invokeIPC('vfs:reveal', name),
  listVfsRoots:    (): Promise<string[]> => invokeIPC('vfs:list-roots'),
  addVfsRoot:      (dir: string): Promise<boolean> => invokeIPC('vfs:add-root', dir),
  removeVfsRoot:   (dir: string): Promise<boolean> => invokeIPC('vfs:remove-root', dir),
  // #26: personas
  listPersonas:    (): Promise<{ personas: any[]; activeId: string | null }> => invokeIPC('persona:list'),
  savePersona:     (p: any): Promise<any> => invokeIPC('persona:save', p),
  deletePersona:   (id: string): Promise<boolean> => invokeIPC('persona:delete', id),
  setActivePersona:(id: string | null): Promise<boolean> => invokeIPC('persona:active', id),
  mcpStatus:       (): Promise<{ servers: { name: string; transport: string }[]; configPath: string }> => invokeIPC('mcp:status'),
  openFileExplorer: (): Promise<void> => invokeIPC('file-explorer:open'),

  // Session persistence
  saveSession: (sid: string, data: any): Promise<void> => invokeIPC('session:save', sid, data),
  loadSession: (sid: string): Promise<any> => invokeIPC('session:load', sid),

  // P1-B4 #20: cron jobs
  listCronJobs:   (): Promise<any[]> => invokeIPC('cron:list'),
  createCronJob:  (job: any): Promise<any> => invokeIPC('cron:create', job),
  updateCronJob:  (id: string, patch: any): Promise<void> => invokeIPC('cron:update', id, patch),
  deleteCronJob:  (id: string): Promise<void> => invokeIPC('cron:delete', id),

  // Debug
  logMessage: (msg: string): void => sendIPC('renderer:log', 'log', msg),

  // ── Agent stats ──
  getAgentStats:      (): Promise<any> => invokeIPC('agent-stats'),
  trackToolCall:      (name: string, ok: boolean, dur: number): Promise<void> => invokeIPC('agent-stats:track-tool', name, ok, dur),
  trackError:         (pattern: string, suggestion: string): Promise<void> => invokeIPC('agent-stats:track-error', pattern, suggestion),
  trackAttempt:       (task: string, attempt: number, approach: string, ok: boolean): Promise<void> => invokeIPC('agent-stats:track-attempt', task, attempt, approach, ok),
  trackContextBullet: (id: string, desc: string): Promise<void> => invokeIPC('agent-stats:track-context', id, desc),
  trackDecision:      (target: string, prediction: string, actual: string, verified: boolean): Promise<void> => invokeIPC('agent-stats:track-decision', target, prediction, actual, verified),
  updateCapabilityScore: (name: string, score: number, max: number): Promise<void> => invokeIPC('agent-stats:score', name, score, max),

  // ── Skill Hub ──
  skillsList:              (): Promise<import('../shared/ipc-channels').SkillEntry[]> => invokeIPC('skills:list'),
  skillsGet:               (name: string): Promise<any> => invokeIPC('skills:get', name),
  skillsInstall:           (skill: unknown): Promise<boolean> => invokeIPC('skills:install', skill),
  skillsRemove:            (name: string): Promise<boolean> => invokeIPC('skills:remove', name),
  skillsSetActive:         (name: string, active: boolean, agent?: string): Promise<boolean> => invokeIPC('skills:set-active', name, active, agent),
  skillsSyncHermes:        (): Promise<{ synced: number; failed: string[] }> => invokeIPC('skills:sync-hermes'),
  skillsSyncClaude:        (): Promise<any> => invokeIPC('skills:sync-claude'),
  skillsSyncCursor:        (): Promise<any> => invokeIPC('skills:sync-cursor'),
  skillsSyncCodex:         (): Promise<any> => invokeIPC('skills:sync-codex'),
  skillsSyncOpenClaw:      (): Promise<any> => invokeIPC('skills:sync-openclaw'),
  skillsCount:             (): Promise<number> => invokeIPC('skills:count'),
  skillsCategories:        (): Promise<import('../shared/ipc-channels').CategoryData> => invokeIPC('skills:categories'),
  skillsDiscover:          (): Promise<any[]> => invokeIPC('skills:discover'),
  skillsCommunityRegistry: (): Promise<{ version: number; skills: any[] }> => invokeIPC('skills:community-registry'),
  skillsRefreshCommunity:  (): Promise<import('../shared/ipc-channels').CommunityResponse> => invokeIPC('skills:refresh-community'),
  skillsSearchGitHub:      (): Promise<import('../shared/ipc-channels').GitHubSearchResult> => invokeIPC('skills:search-github'),
  skillsInstallRemote:     (rawUrl: string, name: string, category: string): Promise<{ ok: boolean; name?: string; error?: string }> => invokeIPC('skills:install-remote', rawUrl, name, category),

  // ── Habit Engine ──
  habitGetState:      (): Promise<any> => invokeIPC('habit:state'),
  habitGetEvents:     (limit?: number): Promise<any[]> => invokeIPC('habit:events', limit),
  habitGetHabits:     (): Promise<any[]> => invokeIPC('habit:habits'),
  habitGetSegments:   (date: string): Promise<any[]> => invokeIPC('habit:segments', date),
  habitPause:         (): Promise<void> => invokeIPC('habit:pause'),
  habitResume:        (): Promise<void> => invokeIPC('habit:resume'),
  habitGetBriefing:   (): Promise<any> => invokeIPC('habit:briefing'),
  habitGetContextText:(userMessage?: string, currentApp?: string): Promise<string> => invokeIPC('habit:context-text', userMessage, currentApp),
  habitGetDeviations: (currentApp?: string): Promise<any[]> => invokeIPC('habit:deviations', currentApp),
  habitConfirm:       (id: number): Promise<void> => invokeIPC('habit:confirm', id),
  habitDismiss:       (id: number): Promise<void> => invokeIPC('habit:dismiss', id),
  habitActivate:      (id: number): Promise<void> => invokeIPC('habit:activate', id),
  habitExtract:       (): Promise<any> => invokeIPC('habit:extract'),
  habitAutomation:    (): Promise<any> => invokeIPC('habit:automation'),
  habitRunPipeline:   (): Promise<any> => invokeIPC('habit:run-pipeline'),
  habitGetScore:      (): Promise<number> => invokeIPC('habit:score'),
  habitExecute:       (id: number): Promise<any> => invokeIPC('habit:execute', id),
  habitGetWeeklyReport: (): Promise<any> => invokeIPC('habit:weekly-report'),
  habitGetScoreInsight: (): Promise<any> => invokeIPC('habit:score-insight'),
  habitRunWeekly:     (): Promise<any> => invokeIPC('habit:run-weekly'),
  habitIsEnabled:     (): Promise<boolean> => invokeIPC('habit:enabled'),
  habitSetEnabled:    (enabled: boolean): Promise<void> => invokeIPC('habit:set-enabled', enabled),
  habitIsAISummary:   (): Promise<boolean> => invokeIPC('habit:ai-summary-enabled'),
  habitSetAISummary:  (enabled: boolean): Promise<void> => invokeIPC('habit:set-ai-summary', enabled),
  habitExport:        (): Promise<string> => invokeIPC('habit:export'),
  habitDeleteAll:     (): Promise<void> => invokeIPC('habit:delete-all'),

  // ── Voice ──
  voiceStart:     (): Promise<boolean> => invokeIPC('voice:start'),
  voiceStop:      (): Promise<void> => invokeIPC('voice:stop'),
  voiceInterrupt: (): Promise<void> => invokeIPC('voice:interrupt'),
  voiceAsr:       (audioBase64: string): Promise<string> => invokeIPC('voice:asr', audioBase64),
  voiceTts:       (text: string, id: string): Promise<boolean> => invokeIPC('voice:tts', text, id),
  onVoiceAsrResult: (callback: (text: string) => void): (() => void) =>
    onPush('voice:asr-result', callback),
  onVoiceTtsReady: (callback: (id: string, path: string) => void): (() => void) =>
    onPush('voice:tts-ready', callback),
  onVoiceTtsError: (callback: (id: string, message: string) => void): (() => void) =>
    onPush('voice:tts-error', callback),
  onVoiceSpeaking: (callback: (active: boolean) => void): (() => void) =>
    onPush('voice:speaking', callback),
  onVoiceInterrupt: (callback: () => void): (() => void) =>
    onPush('voice:interrupt', callback),
  onVoiceEmotion: (callback: (emotion: string) => void): (() => void) =>
    onPush('voice:emotion', callback),

  // ── Generative UI ──
  genui: {
    listSpecs:     (): Promise<any[]> => invokeIPC('genui:list-specs'),
    listStatuses:  (): Promise<any[]> => invokeIPC('genui:list-statuses'),
    runSpec:       (id: string): Promise<any> => invokeIPC('genui:run-spec', id),
    stopSpec:      (id: string): Promise<any> => invokeIPC('genui:stop-spec', id),
    saveSpec:      (spec: any): Promise<any> => invokeIPC('genui:save-spec', spec),
    removeSpec:    (id: string): Promise<any> => invokeIPC('genui:remove-spec', id),
    modifySpec:    (id: string, instruction: string): Promise<any> => invokeIPC('genui:modify-spec', id, instruction),
    focusSpec:     (id: string) => sendIPC('genui:focus-spec', id),
    open:          () => sendIPC('genui:open'),
    openCard:      (specId?: string) => sendIPC('genui:open-card', specId),
    // PROBE channel: page console is NOT forwarded to main (contextIsolation),
    // so diagnostic probes go through this instead of console.*.
    log: (...a: any[]) => { try { sendIPC('renderer:log', 'warn', ...a) } catch { /* window closing */ } },

    setWebhook:    (url: string): Promise<void> => invokeIPC('genui:set-webhook', url),
    pulledOut:     (): Promise<string[]> => invokeIPC('genui:pulled-out'),
    openPath:      (p: string): void => { try { sendIPC('genui:open-path', p) } catch { /* closing */ } },
    openExternal:  (url: string): void => { try { sendIPC('genui:open-path', url) } catch { /* closing */ } },
    nameDraft:     (title: string) => sendIPC('genui:name-draft', title),
  },
  onSpecChanged:    (callback: (spec: any) => void): (() => void) => onPush('genui:spec-changed', callback),
  onSpecRemoved:    (callback: (id: string) => void): (() => void) => onPush('genui:spec-removed', callback),
  onStatusChanged:  (callback: (status: any) => void): (() => void) => onPush('genui:status-changed', callback),
  onCardBind:       (callback: (specId: string) => void): (() => void) => onPush('genui:card-bind', callback),
  onDeckHide:       (callback: (ids: string[]) => void): (() => void) => onPush('genui:deck-hide', callback),
  onEditSpec:       (callback: (info: { id: string; title: string } | null) => void): (() => void) => onPush('genui:edit-spec', callback),
}

contextBridge.exposeInMainWorld('deskAppAPI', deskAppAPI)

// Forward all console output to main process for debugging
const orig = { log: console.log, error: console.error, warn: console.warn }
console.log = (...a: any[]) => { orig.log(...a); sendIPC('renderer:log', 'log', ...a) }
console.error = (...a: any[]) => { orig.error(...a); sendIPC('renderer:log', 'error', ...a) }
console.warn = (...a: any[]) => { orig.warn(...a); sendIPC('renderer:log', 'warn', ...a) }

export type DeskAppAPI = typeof deskAppAPI
