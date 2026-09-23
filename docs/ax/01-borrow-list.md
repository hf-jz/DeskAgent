# AX 借鉴清单（按主题）

每条三段式：**AX 出处/机制** → **为什么对 DeskApp 有价值** → **落地建议（点名要改/要建的文件）**。
`file:symbol` 均已核对；来自 `git show dc4f36c^:<path>` 的已删文件单独标注。

---

# A. 规格与状态模型

## A1. 统一资源信封 `apiVersion / kind / metadata / spec / status`

**AX**：`pkg/apis/v1alpha1/ax.proto` 四种 kind 共用 `api_version(1)+kind(2)+metadata(3)+spec(4)+status(5)`；`types.go:31` 定义 `APIVersion="ax.io/v1alpha1"` 与 `KindTask/KindGateway/KindWorkspace/KindModel`。`ObjectMeta{name, atespace, creation_timestamp}`（`ax.proto:59-63`）。

**DeskApp 现状**：`src/shared/gen-ui-types.ts:14 WindowSpec` 只有 `{id,title,kind,cron,props,layout}`；cron 是 `src/main/cron.ts:14 CronJob` + `cron_jobs` 表（`:54`）；会话是 `src/main/session-store.ts:39` 的 `sessions` 表。三类各有一套字段约定，没有版本位。

**落地**：新建 `src/shared/spec.ts`：`interface SpecEnvelope<K> { apiVersion: 'deskapp.io/v1alpha1'; kind: K; metadata: {name, createdBy?, createdAt}; spec: unknown; status?: SpecStatus }`，让 window spec / cron job / model config /（后续）task 都套这层壳；`spec` 内部按 kind 各自 typed。迁移期只写新字段，旧 JSON 走 normalizer（A2）。

## A2. 严格解码 + legacy normalizer + reserved 防复用

**AX**：`types.go:57-87` —— manifest 泛化解码 → 转 JSON → `protojson.UnmarshalOptions{unknown fields 是 error}` 严格解码，**拼错的字段直接拒绝**；`normalizeWorkspace`(`types.go:161`)、`normalizeModel`(`types.go:171`) 在严格解码前把旧写法（`spec.mcp` 裸列表、`secretKeyRef`、裸字符串密钥名）就地改写；`ax.proto:77-78` 用 `reserved 1; reserved "goal"` 钉死被删字段的编号与名字。客户端解析、服务端只见 typed RPC（`cmd/ax/main.go:229-230`）。

**DeskApp 现状**：`shared/gen-ui-types.ts:38 validateSpec` 只做"必填 + kind 白名单 + 类型粗检"，未知字段原样保留，没有 schemaVersion，也没有旧 shape 迁移函数——LLM 拼错的字段会静默落 `specs.db`（`gen-ui.ts:130 saveSpec`）。

**落地**：`validateSpec` 改为严格模式（`unknownFields` 报错 + 返回结构化错误列表）；加 `SPEC_SCHEMA_VERSION` 常量与 `normalizeLegacySpec(raw)`（迁移 `props` 旧字段、`kind` 旧别名）；落库前先在 main 进程校验成 typed 对象（`gen-ui.ts:130` 入口），禁止裸 JSON 直写。

## A3. `status.phase` + `conditions[]`（本次分析的地基）

**AX**：`TaskStatus{phase, id, actor, worker_ip, pending_approval, usage, conditions}`（`ax.proto:121`）；`Condition{type,status("True"|"False"),last_transition_time,reason,message}`（`ax.proto:143`）。三个 condition 类型：`condReady="Ready"` / `condWorkspaceReady="WorkspaceReady"` / `condGatewayReady="GatewayReady"`（`internal/controller/reconciler.go:320-326`）。`setCondition`（`reconciler.go:348` 附近，调用点 `:202/:217/:299/:301/:303/:332`）**按 type 合并原地更新**，只在真正转移时改 `lastTransitionTime`；phase 会来回变（Running↔Suspended↔Failed），condition 记录跨生命周期存活的属性（注释 `reconciler.go:331`）。语义定义在 `docs/concepts.md:13-21`。

**DeskApp 现状**：三处各说各话 —— `agents/orchestrator.ts:24` `status: 'pending'|'running'|'done'|'failed'`；`shared/gen-ui-types.ts:26 SpecStatus = 'idle'|'running'|'ok'|'error'`；`shared/agent-events.ts:37 AgentEvent` 只有 turn 级事件、无资源状态。渲染层 `bubble/TaskTreePanel.tsx` 因此只能显示 4 种节点态，表达不了"workspace 初始化中/已暂停/待批准/失败但可重试"。

**落地**：新建 `src/shared/task-state.ts`（shared 层，main 与 renderer 共用）：
```ts
export const TaskPhase = { pending:'pending', running:'running', suspended:'suspended',
  failed:'failed', completed:'completed', terminating:'terminating' } as const
export type TaskPhase = typeof TaskPhase[keyof typeof TaskPhase]
export interface TaskCondition { type:'Ready'|'WorkspaceReady'|'GatewayReady'|'BridgeReady'
  status:'True'|'False'; reason:string; message:string; lastTransitionAt:number }
export function setCondition(list, type, status, reason, message): TaskCondition[]  // 照抄 reconciler 的合并语义
```
用 `TaskPhase` 替换 `orchestrator.ts:24` 的 4 值 union 与 `gen-ui-types.ts:26` 的 SpecStatus（后者是 `idle/running/ok/error` → `pending/running/completed/failed`）；`TreeNode` 增加 `conditions?: TaskCondition[]`。**注意不要照抄 AX 的裸字符串 phase**（它只有 `PhaseTerminating` 是常量，`types.go:41`），用上面的常量对象。

## A4. `Model` 是"命名模型配置"，不是模型

**AX**：`docs/concepts.md:39-43` 原话 "A `Model` is not a model. It is a named model configuration"；`ModelSpec{provider, model, secret_key(SecretKeyRef{name,key}), parameters(自由 Struct)}`（`ax.proto:246-257`，例见 `docs/manifests.md:104-151`，google/anthropic 两套）；密钥值不进 manifest，只存引用。客户端侧 `internal/model/client.go`：`Config`(`:59`) / `ConfigFromCRD`(`:98`) / `WithStore`(`:191`) / `resolveAPIKey`(`:271`，顺序 显式 key → 自定义 resolver → K8s secret → 环境变量) / `Generate`(`:458`)，默认值集中在 `:39-47`。

**DeskApp 现状**：模型配置散在 `agents/task-router.ts`（`WORKER_MODEL`/`PLANNER_MODEL` 常量 + 路由逻辑里拼 model 名）、`settings-store.ts`、`shared/ipc-channels.ts:147 BrainSlotConfig`。换 provider 要改路由代码。

**落地**：新建 `src/main/agents/model.ts`：`interface ModelSpec { provider; model; secretKeyRef?: {name; key}; parameters?: Record<string, unknown> }`，**让 `ModelSpec` 直接复用/成为 `BrainSlotConfig` 的超集**，别再造重复类型。密钥走现有 `secrets.ts`（macOS 钥匙串）；`task-router.ts` 改成纯函数 `configFromModel(model): BrainSlotConfig`（对标 `ConfigFromCRD`）+ `resolveApiKey(spec, secrets)`（照抄那个 4 级顺序）。UI 落在 `settings/LLMTab.tsx`。

## A5. `apply` 幂等三态 + `get` 表格列 + `describe/watch`

**AX**：`cmd/ax/main.go:270` 起每个 kind 都先 `Get` 现有资源 → `applyOutcome(err, existing.GetSpec(), newSpec)` 得出 `created / configured / unchanged`，再 `Update*`。`runGet`（`main.go:364-402`）列 `NAME ATESPACE PHASE ACTOR WORKER-IP AGE`，workspaces 列 `GIT-REPOS MCP-SERVERS`；`formatAge`（`main.go:1032`）输出 `30s/5m/2h/3d`。`runDescribe`（`main.go:565`）输出 Name/Phase/Conditions 表；`runWatch`（`main.go:774`）流式推进到终态。

**DeskApp 现状**：cron 作业没有 in-place 编辑语义（改了不知道改没改）；`scheduler/ProjectsView.tsx`、`scheduler/TaskTimeline.tsx`、Settings→Sessions 列表没有统一的"名称/阶段/执行者/时长"列；没有 `formatAge` 之类的工具。

**落地**：① `cron.ts` 的保存入口返回 `created|configured|unchanged` 并透传到 `settings/CronTab.tsx` 提示；② `src/renderer/src/lib/format.ts` 加 `formatAge(ms)`（`main.go:1032` 的四段式）；③ `ProjectsView.tsx` / Sessions 列表加 `NAME PHASE ACTOR AGE` 列；④ describe 内容直接喂 `bubble/TaskTreePanel.tsx` 的详情区。

## A6. `watch`：工作队列与状态通知分离

**AX**：`internal/store/redis/store.go` —— 工作队列是 Stream `ax:stream:tasks`（`:32`），只承载 `action:"reconcile"|"delete"`（`SaveTask` `XAdd` `:171`、`MarkTaskDeleting` `:315`）；状态通知是每任务一个 PubSub channel `ax:pubsub:task:<ate>:<name>`（`:129`）。关键：`UpdateTaskStatus`(`:271`) **只 Publish 不 XAdd** —— 否则 controller 写状态又触发 reconcile，死循环。`WatchTask`(`:820`) 订阅该 channel；gRPC 层先发 `Action:"INITIAL"` 快照（`internal/server/server.go:217`），后续 `MODIFIED`（`:230`），phase ∈ {Running,Failed,Completed} 时关流（`:233`，只适合 CLI 一次性等待，DeskApp 别抄这条终止语义）。单机等价物见 `internal/store/memory/store.go:59`（单 chan 容量 1000 + watchers map）。

**DeskApp 现状**：`agents/event-bus.ts` 已有 canonical `AgentEvent`（`shared/agent-events.ts:37`，带 `v:1`/`turnId`/`ts`/`type`），但只有执行期事件；资源状态靠 `ipc-handlers.ts` 里临时 push（如 `tree:update`），**没有"按 id 订阅某个任务状态"的通道**；orchestrator 执行中既改状态又 emit（`orchestrator.ts` 全量树推送），缺少"写状态不重入"的边界。

**落地**：`shared/ipc-channels.ts` 加 push 通道 `'task:watch': [taskId, snapshot]`；`event-bus.ts` 里加 `setState(id, patch)` 单点写入口（写库 + 广播由它统一做），orchestrator 的 emit 改走它；渲染层 `TaskTreePanel.tsx` 订阅。主进程内 EventEmitter 足够，不需要 pubsub。

## A7. 技能源抽象：`[]SkillGroup{Dir, Skills[]}` + fail-safe 本地发现（**已删代码**）

**AX**（`git show dc4f36c^:internal/skills/skills.go`、`.../skills/local/local.go`，另见 commit `f327e23`/`49d0c1b`）：mode-agnostic 的 `[]skills.Group{Group{Dir, Skills []Skill{ID, Dir}}}`；`local.Discover()` 扫描每个 enabled path，把"含 `SKILL.md` 的子目录"当技能（子目录名 = skill id），**unreadable/缺失/无技能一律 log+skip，绝不阻断**；`91567b2` 用 `[]skills.Group` 替代 `skills.Available`（统一源无关结果）。另 `internal/skills/geminienterprise/{client,materialize,unzip}.go`（400+165+202 行）是"从注册表拉取 + 解包到统一路径"的完整实现。

**DeskApp 现状**：`src/main/skill-hub/{store,types,translator}.ts` 管理技能源，但内置技能靠 `resources/install_builtin_skills.py` 脚本安装，没有统一的"发现结果"类型，也没有从注册表拉取+解包的能力。

**落地**：`skill-hub/types.ts` 定义 `SkillGroup{Dir, Skills: {ID, Dir}[]}`，新增 `discoverLocal(path)`（`<path>/<skill-id>/SKILL.md`，失败跳过）；消费者（`agents/context.ts:buildCatalog`）只依赖 `SkillGroup[]`。注册表拉取/解包按需再做（P2）。

## A8. `PendingApproval` / `UsageStats` 作为状态字段

**AX**：`TaskStatus` 内嵌 `pending_approval{id,action,requested_at}` 与 `usage{prompt_tokens,completion_tokens}`（`ax.proto:121-130`）。

**DeskApp 现状**：审批走 `src/main/ipc-handlers.ts` 的 `pendingApprovals`（bridge 内）+ `bubble/ApprovalCard.tsx`；用量散在 `agent-stats.ts`；预算告警是 `inbox.ts` 的 `budget-warning` kind。

**落地**：把审批与用量提升为任务状态的字段（`task-state.ts` 的 `TaskStatus.pendingApproval?` / `usage?`），`ApprovalCard` 的 props 与 `PendingApproval` 对齐；`budget-warning` 由 `usage` 派生而不是各自算。

---

# B. 运行时契约与工作区

## B1. runner 契约：一份文档 + 一个进程接口

**AX**：`docs/runner.md` 是权威契约（"How a runner is launched" 表格 + "What a runner must do" + 8 条 checklist）：控制面**从不直接跑 `spec.command`**，永远以固定 entrypoint 拉起容器，spec 通过环境变量投递（`AX_TASK_YAML` / `AX_WORKSPACES_YAML`）；契约要求 ① 固定端口上 `GET /healthz`（存活）、`GET /readyz`（未就绪 503）；② 每个 workspace 只预热一次；③ 起 `spec.command` 子进程、注入 `AX_METADATA_URL` + `spec.env`、**独立进程组**（`runner/runner.go:182 cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid:true}`）；④ 命令退出后 runner 继续活着（`runner.go:195` 注释 "Keep the sandbox up and inspectable until told to stop"）；⑤ SIGTERM 转发进程组 + 10s 宽限（`runner.go:47-49 stopGracePeriod`）后 SIGKILL（`:210-216`）；⑥ debug 才开 guest 服务。三级自定义：扩展默认镜像 / `import runner` 调 `runner.Run`（`runner.Config{Port,Task,Workspaces,OnCommandExit}`）/ 任意语言从零写。参考实现 `cmd/ax-task-runner/main.go`（薄壳，`:54` 起解析 flags、`:94`/`:119` 从 env 或 `--task-file`/`--workspace-file` 读 spec —— **本地可脱机测**）。

**DeskApp 现状**：`agents/executor.ts:9 AgentExecutor{name, execute, isAvailable, prewarm?, shutdown?}` 只是 TS 代码接口，没有对外契约、没有自定义 runner 机制；hermes(`hermesGatewayExecutor`/`desktopAgentExecutor`)、openclaw、claude-code、codex（`agents/manager.ts` + `detect-*.ts` + `cli-executor.ts`）各自为战，新增一种后端 = 新写一个 executor 类 + 一个探测函数。

**落地**：新建 `src/main/agents/runner-contract.ts`（`RunnerSpec{command, env, workspaceProfile, debug, egressAllowlist?}` + 校验）+ `docs/runner-contract.md`（写明：启动注入哪些环境变量、必须暴露什么就绪信号、如何响应中断/暂停）；让 `cli-executor.ts` 的每种 CLI 变成"20 行 adapter"（把 CLI 的 JSONL/stdout 映射到 `TaskStreamCallbacks`），而不是新写 executor；`CompositeExecutor`（`executor.ts:37`）作为唯一调度点。

## B2. Workspace profile 预热 + marker 幂等

**AX**：`internal/workspace/setup.go:83 SetupWorkspace(ctx, ws, targetPath, goal)`：maiden run 时 ① `cloneRepos()` 逐仓库 `git init` + `fetch`（浅克隆 + `retry()` 5 次/2s 退避，`:151`/`:238`，参数直传 git 不经 shell）② 建技能目录 ③ 有 `goal` 时起 agent 预装依赖；完成后写 marker（`:101 markerPath = AXDir/MarkerName(targetPath)`、`:125 writeMarker`、`:335 MarkerName`），**marker 存在即跳过**（`:102`）——这是 resume 后不重克隆的关键。`SetupResult{WorkspacePath, ClonedRepos, SkillsMounted, IsMaidenRun, BootstrapRan}`（`:71`）。`Workspace.spec = {git[], mcp{registries,servers}, skills{registries,path}}`（`docs/manifests.md:56-79`）。

**DeskApp 现状**：`src/main/vfs.ts` 的 `initVfs()` 只 `mkdirSync(WORKSPACE_DIR)`，`getWorkspaceDir()` 返回一个空目录；技能靠 `skill-hub` 手动装；每轮靠 `agents/context.ts` 的 `buildSnapshot/buildCatalog` 现场组装。**没有可复用 profile**。

**落地**：`vfs.ts` 引入 `WorkspaceProfile{gitRepos[{repo,branch,depth,dir}], skills{path}, mcpConfig?, goal?}` + `initProfile(profile)`：克隆到 `WORKSPACE_DIR` 下、把 skill-hub 技能软链进去、写 `.deskapp/initialized-<hash>` marker 实现幂等；`context.ts` 在首轮 prompt 组装前读 profile 生成环境摘要（**用 hermes 自己干预置，不要再起一个预置 agent**——AX 用 Antigravity 是因为它在集群里没有本地 agent）。

## B3. Suspend/Resume：可恢复的任务现场

**AX**：checkpoint 本身是 Agent Substrate 做的（`internal/substrate/client.go` 的 `SnapshotsConfig{OnPause,OnCommit,OnResume}` + `/workspace` 持久卷），**runner 的职责只是"可被 resume"**：`/workspace` 是持久卷、marker 让 resume 不重克隆（`docs/runner.md`）、SIGTERM 时优雅退出并 flush（`:208-216`）。`docs/runner.md` 原话："Resume restarts the container, and re-cloning into a restored workspace would destroy the agent's state"。生命周期转换（suspend 把 `Ready` 置 False/reason `TaskSuspended`，resume 还原）在 `docs/concepts.md:21`。

**DeskApp 现状**：关气泡窗口 → `index.ts` 的 `bridgeManager.dispose(String(wcId))` 直接杀掉 python 进程，**进行中的那一轮**随之中断；hermes 的对话历史只在 `bridge.py` 内存里（`_trim_history` 裁剪的也是内存 list）。
**核对修正（2026-09-22）**：已完成的历史**并不是只有内存** —— 渲染层每次 `messages` 变化都落盘（`renderer/src/bubble/hooks/useSession.ts:81-86` `saveSession`），重开气泡时 `ipc-handlers.ts` 的 `sessions:open` 会把这些轮次 `injectContext` 回灌给新 bridge。所以真正缺的只是"进行中的 turn 可续跑"；而 `WORKSPACE_DIR` 本来就是持久目录 —— **天然具备 AX 的持久卷条件，缺的只是"把进行中状态也落盘 + 续跑"**，这需要 suspend 帧 + resume UI，归 P1。

**落地**：`resources/bridge.py` 加 `checkpoint()`：把完整 history + session_id + 未完成的工具调用/审批上下文写成 JSON 到 `WORKSPACE_DIR/.deskapp/state.json`（用 `session-store.ts` 的 sessionId 关联）；`_get_or_create_agent()` 启动时若发现 state 文件则恢复；`DesktopAgentBridge.shutdown()` 加 `suspend` 分支（先 checkpoint 再退出）与 `dispose` 分支（真删）区分，UI 上对应"暂停的气泡"（`task-bubble.ts` / `dock-window.ts` 显示暂停态）。`agents/desktop-agent.ts` 的 `IDLE_TIMEOUT_MS`(24h) 语义不变。

## B4. Egress allowlist（工具层 host 白名单）

**AX**：`Gateway.spec.egress.allowlist.hosts[]`（`docs/manifests.md:81-102`）；`internal/substrate/client.go:ApplyEgressPolicy()` 把条目归三类：`"*"`/`"0.0.0.0/0"` → 全放行、含 `/` → CIDR、否则 → hostname pattern；生成 `EgressPolicy` 后 `Create/UpdateActorEgressPolicy`。执行点在网关层，**runner 与 agent 完全无感**。

**DeskApp 现状**：`resources/bridge.py` 的工具调用直接在本机执行，只有 `agents/grants.ts`（会话级 always-allow）+ `agents/risk.ts`（RiskClass）+ `_deskapp_approval_callback` 做人工审批，**没有机器层的 host 白名单**。

**落地**：落在工具层（桌面唯一可行点）：`bridge.py` 加 `egress_guard`，解析出网命令里的 host，对照从 `trust.ts` 派生的 allowlist 做三类判断（`*` / CIDR / 域名后缀），未命中 → 提升 `RiskClass` 并转现有审批流（不新造轮子）。OS 层只能粗粒度：macOS `sandbox-exec` 只支持 `(allow network*)`/`(deny network*)` 全开全关且已 deprecated，`pf` 需 root —— 因此 host 级过滤必须自己做。

## B5. Metadata 自省端点 + `readyz` 语义

**AX**：`internal/metadata/server.go` 单端口多路复用 HTTP 与 gRPC(h2c)：`/healthz`、`/readyz`（`workspaceReady` 未就绪返回 503，`SetWorkspaceReady` `:170` 由 workspace 预置完成驱动，端点 `:94`）、`/metadata/v1alpha1/ax/task`（YAML 全文）、`/metadata/v1alpha1/ax/workspaces`（多文档流）；`AX_METADATA_URL` 注入子进程（`runner/runner.go`），agent 无需 SDK 即可自省。guest 服务只在 `spec.debug:true` 时启用（`server.go:71` + `guest.NewServer` `:80`）。

**DeskApp 现状**：气泡与 `bridge.py` 之间只有 JSONL over stdio；没有健康/就绪/元数据概念。表现层的后果就是"气泡卡在 thinking…"（心跳 `HEARTBEAT_MS=24h` —— 见 `agents/desktop-agent.ts` 注释，只有 provider 首字超时 180s 兜底）。

**落地**：`bridge.py` 的 stdio 协议增加三类消息：`ready`（= profile 预热 + agent 初始化完成）、`health`（周期心跳）、`meta`（当前 `RunnerSpec`/工作区/能力清单）；`desktop-agent.ts` 用 `ready` 而不是"进程活着"判断热备可用性，用 `health` 驱动 UI 的"运行中/无响应"（把 24h 心跳拆成"进程活着（短）+ 任务静默（长，保留 24h）"两个维度）。`agents/context.ts` 注入工作区路径 + 能力清单（等价 `AX_METADATA_URL` 语义）。

## B6. Debug/Attach 必须显式 opt-in

**AX**：guest 服务（ProcessService 起/查/流/杀进程、FileSystemService 读写）**默认关闭**，`spec.debug:true` 才开（`internal/metadata/server.go:71`），因为"allow arbitrary process execution and file access"；`ax ssh` 拒绝连接未 opt-in 的任务（`docs/runner.md`）。

**DeskApp 现状**：`src/main/img2threejs.ts` 的控制台窗口是"旁观 agent 输出"的雏形，但没有统一的"attach 到某个运行中气泡看内部"的开关，`screen-control.ts` 也是常开能力。

**落地**：`runner-contract.ts` 加 `debug: boolean`（默认 false）；`bridge.py` 仅在 debug 时把完整工具调用/中间推理转发到旁观通道；旁观 UI 复用 img2threejs 控制台窗口形态（按需 attach，不是全量刷屏）。

---

# C. 调度、存储与状态机

## C1. level-based reconciler（期望态 → 观察态 → 收敛）

**AX**：`internal/controller/reconciler.go:94 Reconcile(ctx, task, gateway, workspaces...)` 是纯 level-based、幂等：输入期望 spec + 当前 status，把当前推向期望，全程无"上次事件"边状态；每步 `Ensure*`（`:119 EnsureAtespace` / `:171 EnsureActorTemplateWithImage` / `:181 EnsureActor` / `:200 ApplyEgressPolicy` / `:208/:224 Suspend/ResumeActor`），失败即 `setNotReady` + `phase=Failed` 并 return（不留半成品）。幂等细节：actor 名恒等于 task 名（`:128`）、spec 变了派生新模板（`:389` 对 image+env 做 sha256）、删除时按 pattern 反查历史模板（`:405`、`ReconcileDelete` `:411`）。

**DeskApp 现状**：`agents/orchestrator.ts` 的 `runTaskTree` 是一次性边触发（plan→execute→review 跑完即结束），中断/失败无法从中间态恢复；`BridgeManager` 也没有"期望态 vs 观察态"。

**落地**：新建 `src/main/agents/reconciler.ts` + `task-store.ts`：把 plan 结果作为 **desired spec** 持久化、执行进度作为 **observed status** 写回，`reconcile(tree, status): status` 幂等可重复调用；orchestrator 每次变更仍全量 emit（保留现有 IPC 习惯），但状态来源改为持久化对象。

## C2. 单队列 + 有界并发 + "失败也推进"

**AX**：`internal/store/store.go:37-39` 定义 `EventQueue`：每个事件恰好投递给 group 的一个成员，**Ack 前保持 pending**，崩溃 worker 的事件可被重新认领（Redis 侧 `XGroupCreateMkStream` `:731` / `XReadGroup` `:768` / `XAck` `:792`；`Close()` 故意不注销 consumer 以便 reclaim `:795`）。`internal/controller/worker.go:67 Run` 是每进程一个消费循环；**关键设计**：即使 reconcile 失败也照常 Ack（`:92`/`:101`），注释 `:66` "a bad task cannot wedge the queue"（坏任务不卡队列，重试靠重新 apply）。批量 `Count=10` 是唯一的准入控制。

**DeskApp 现状**：每个气泡各 spawn 一个 python bridge（`BridgeManager`），`orchestrator.ts` 只有 tree 内 `MAX_PARALLEL=3`；cron / scheduler / orchestrator 三套入口没有统一队列；我刚加的 `bridge-policy.ts`/`mem-guard.ts` 是内存侧的上限，不是准入控制。

**落地**：新建 `src/main/agents/task-queue.ts`：SQLite 表 `tasks(id, kind, payload_json, status='pending'|'claimed'|'done', claimed_at, attempts)`，单 worker 循环消费，`claimed_at` 超时回退 pending 即等价 AX 的 pending reclaim；全局并发信号量与 `mem-guard` 的 bridge 上限联动；**抄"失败也推进"原则**：失败标 failed + 落 `deadletter.ts`，不无限重试卡队列。这同时能把 cron/scheduler/orchestrator 收敛到一条循环。

## C3. 持久化：SQLite 双实现，不要 Redis

**AX**：全状态在 store，`ax-server`/`ax-controller` 无本地缓存（`internal/server/server.go` 只依赖 `store.Store`，`cmd/ax-controller/main.go:105`）——这是能 `replicas: N` 的前提。Redis 侧 key 布局：`ax:task:<ate>:<name>`（`:81`）、两个 ZSet 索引（全局 `:121` + per-atespace `:125`，score=UnixNano 实现最新在前）、`TxPipeline` 把"写记录+索引+事件+Publish"压成一个原子事务（`:167`）。**同时提供 `memory` 实现**与 Redis 语义一致（`internal/store/memory/store.go`，`clone[T]` `:37` 深拷贝防外部改内部状态，`:370` 注释说明 group 参数只为接口一致）。

**DeskApp 现状**：`session-store.ts` 单 `sessions` 表（`CREATE TABLE IF NOT EXISTS`，无 schema version）；cron 是 `cron.db`，scheduler 是 `scheduler.db`，各自为政；没有 store 接口与内存实现。

**落地**：`task-store.ts` 导出 `interface TaskStore`（`saveTask/getTask/listTasks/updateStatus/markDeleting/deleteTask`），提供 `memory` 与 `sqlite` 两个实现；表 `tasks(id, kind, spec_json, status_json, phase, conditions_json, created_at, updated_at)` —— `spec_json` / `status_json` 分列就是 `SaveTask` 与 `UpdateTaskStatus` 的对应。**抄 `clone()` 深拷贝习惯**（任何"读出来改完写回"的 store 都该防外部改内部）。**别抄** `TxPipeline`/ZSet/MGet —— SQLite 的 `BEGIN IMMEDIATE` + `ORDER BY id DESC` 天然覆盖。

## C4. 两阶段删除（Terminating 语义）

**AX**：`MarkTaskDeleting`（`internal/store/redis/store.go:295`）先置 `phase=Terminating` + Publish 通知 watcher + `XAdd "delete"`，**记录保留**；worker 收到 delete 后 `ReconcileDelete`（`reconciler.go:411`）清理资源，成功才 `DeleteTask`（`worker.go:115`）；失败则留在 Terminating（`worker.go:110-114` 注释：可见性 + 重新 delete 重试）。gRPC `DeleteTask`(`internal/server/server.go:132`) 只标记，客户端轮询到 NotFound。

**DeskApp 现状**：中断/删除一刀切 —— `executor.ts` 的 `AbortHandle` + `event-bus.ts` 的 `turn.interrupted` 直接杀 bridge 进程，没有"标记 → 清理子进程 → 确认回收 → 删记录"的序列。

**落地**：`task-store.ts` 加 `markDeleting(id)`/`deleteTask(id)`；abort 流程改为 `markDeleting → 等 bridge 退出 + 清理临时文件 → deleteTask`，清理失败留 `terminating` 并落 `deadletter.ts`；渲染层显示 terminating 态即可，不必做"轮询到 NotFound"。

## C5. 失败/坏任务的处理原则（比机制更值得抄）

**AX**：三类硬约束 —— ① 坏任务不卡队列（`worker.go:66`）；② reconcile 失败也写回 status（`worker.go:162`）让状态可见；③ `ax delete` 阻塞到清理完成（`docs/concepts.md:21`）。

**DeskApp 现状**：`deadletter.ts` 已存在但只用于部分链路；失败态在 `gen-ui.ts:32 SpecStatus` 里只有 `error` 一个位，没有 reason/message。

**落地**：失败必须带 `reason + message`（`task-state.ts` 的 condition），并且**任何执行入口都要有终态兜底**（这正是之前 P0 实施里踩过的坑：abort handler 必须无条件发终态信号）。

---

# D. 工具与工程流程

## D1. `doctor` 一键自检（**已删代码，最值得抄的一件**）

**AX**（`git show dc4f36c^:cmd/ax/doctor.go`，251 行，`b777313` 新增、`dc4f36c` 删除）：`Stats` 结构体采样 `AssetsDir / SidecarPID / SidecarAlive / SidecarCPU / SidecarRSS / SidecarUptime / SidecarCmd / Endpoint / EndpointActive / PythonVersion / GoVersion / NumGoroutine / MemAllocMB`；`Sampler.Sample()`：读 `assetsDir/sidecar.pid` → `isProcessAlive(pid)`（signal 0）→ `ps -p <pid> -o %cpu,rss,etime,command` → `net.DialTimeout` 探 endpoint → `python3 --version`；`Display.Render()` 分 Sidecar / Assets / Environment 三段。

**DeskApp 现状**：环境问题（python 解释器/venv/网关/密钥/权限/磁盘/内存护栏）只能靠 `setup-wizard.ts` 试错；`BridgeManager` 有 pid（`34d81b7 "Enable sidecar PID tracking"` 正是为此）。

**落地**：新建 `src/main/doctor.ts`，采样：bridge 进程 alive/CPU/RSS/uptime/cmdline（复用 `desktop-agent.ts` 现有 pid）、python 解释器与 venv 存在性+版本、hermes gateway 可达性、钥匙串可读性、工作区目录磁盘余量、`mem-guard` 最近一次采样值、每个 IPC 通道的响应性；暴露 `doctor:run` IPC + 新 `settings/DiagnosticsTab.tsx`（或并入 SecurityTab）。**字段几乎一一对应，是拿来即用的一个文件。**

## D2. 命令形态：`normalizeKind`、`-f -` 读 stdin、客户端解析

**AX**：`cmd/ax/main.go:929 normalizeKind`（`ToLower(TrimSuffix(kind,"s"))` 归一单复数/大小写，未知 kind 报错并列出合法值）；`:948 manifestFromArgs` 支持 `-f file` 或 `-f -`（stdin）；`:229-230` 客户端解析 manifest，服务端只见 typed RPC。

**DeskApp 现状**：194 个 IPC 通道（`grep -c "handleIPC('" src/main/ipc-handlers.ts`），但**没有对外 CLI、没有命令面板**；通道命名不统一（`agents:execute-task` / `cron:create` / `scheduler:create-event` / push `tree:update`）。

**落地**：① `ipc-channels.ts` 按资源归并命名（`task:*` 组：`get/list/update/delete/suspend/watch`），旧名保留 alias 一段时间；② 若要做命令面板，抄 `normalizeKind` 的容错；③ 坚持"校验在入口、存储只见 typed 对象"。

## D3. CI 门禁（当前最大的工程缺口）

**AX**：`.github/workflows/go.yml` —— 每次 push/PR：`actions/checkout`/`setup-go` **按完整 SHA pin**（附版本注释）、`permissions: contents: read`、`go mod tidy` 后 `git diff --exit-code go.mod go.sum`（锁文件漂移即失败）、构建全部 4 个二进制、`go test -v ./...`。`.github/workflows/check-binaries.yml` —— 用 `git diff --numstat --diff-filter=ACM "origin/$BASE...HEAD" | awk '$1=="-"||$2=="-"'` 检出二进制文件并 fail（PR 不许提交二进制）。`Makefile` 分组清晰、全 `.PHONY`；`docs/development.md` 给出 prerequisites/build/test 三段。

**DeskApp 现状**：`.github/workflows/` 只有 `release.yml`（tag 触发、macos-14、`npm ci` + `npm run dmg -- --publish always`）——**push/PR 没有任何 build+test 门禁**；仓库里有 `resources/uv/**`、`resources/hermes-agent/**`、`models/`、以及 `resources/hermes-agent/state.db-wal` 这类运行期文件，误提交无防护。

**落地**：新增 `.github/workflows/ci.yml`：`npm ci` → `npm run build` → `npm run test` → `git diff --exit-code package-lock.json`（锁文件漂移）→ 二进制检查（把 AX 的 awk 那行直接抄过来，注意 `resources/**` 里本就要发布的二进制需在 allowlist 里显式豁免）。另加 `scripts/check.sh` 让本地与 CI 跑同一条命令（对齐 DeskApp 现有 `npm run dmg` 与 CI 同脚本的做法）。

## D4. 可执行 e2e demo 脚本

**AX**：`demo.sh` —— `wait_for PHASE [READY]` 轮询 + `task_field` 用 awk 从 `describe` 抽字段 + `ax ssh -- sh -c` 进沙箱验证，覆盖 apply→watch→ssh→suspend→resume 全生命周期；输出用 `step()`/`run()`（打印命令原样再执行）、`NO_COLOR` 支持。

**DeskApp 现状**：`scripts/` 只有 `build-dmg.sh`、`gen-demos.py`、`entitlements.plist`；setup wizard 是"试错"，没有"证明整条链路通"的验收脚本。

**落地**：`scripts/smoke.sh`（或 `npm run smoke`）：起一个气泡 → 发一条最小任务 → 等终态 → 断言产出 → 清理；用 `demo.sh` 的 `step()`/`wait_for` 输出风格，`OnboardingCard` 的绿灯可以复用它的结果（等价 `runSmokeTest()`）。

---

# 落地顺序（我的建议）

1. **A3（状态词表）** — 零依赖，后面每项都要用它。
2. **B3（suspend/checkpoint）+ B2（marker 幂等）** — 一起做，直接消掉"关窗丢 turn"，且完全本地。
3. **D1（doctor）** — 单文件，立刻降低环境类故障的诊断成本。
4. **D3（CI 门禁）** — 一个 yml，防的是"以后每次改动都可能悄悄坏"。
5. 其余按 README 的 P1/P2 表推进。

# 未验证项

- `EgressAllowlist.Hosts` 的元素类型名与是否含 port 字段（只确认 `internal/substrate/client.go` 里用了 `.Host`）。
- `internal/controller/reconciler.go:348` 的 `setCondition` 精确行号（调用点与合并语义已核实，常量在 `:320-326`）。
- 已删文件的内部实现细节（`harness/antigravityinteractions/*`、`pythonsidecar/*`）在本分册只做了行数与职责级别的引用，见后续 `02-*.md` 分册。
