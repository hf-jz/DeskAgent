# google/ax 借鉴分析（DeskApp）

分析对象：`~/LLM/ax`（module `github.com/google/ax`，Apache-2.0，~14k LOC Go）
分析日期：2026-09-22｜参考版本：commit `d8ed0fe`（工作区 HEAD）
分析方式：主进程自勘 + 4 路并行子代理深挖（声明式规格/CLI、控制平面、沙箱运行时、被删的本地 agent 一代）

## AX 是什么，以及必须先知道的一件事

AX 现在的自我定位是 **声明式 agent 编排器**：把 agentic task 写成 `ax.io/v1alpha1` manifest（四种 kind：`Task` / `Workspace` / `Gateway` / `Model`），`ax apply` 到控制平面，在 K8s + Agent Substrate 沙箱里执行，CLI 刻意做成 kubectl 形状（`apply/get/describe/watch/ssh/suspend/resume/delete`）。

**但它是两代项目，中间做了一次自我否定。** commit `dc4f36c`（"Restructure AX into a general-purpose orchestration layer for agentic tasks"）删掉 19988 行、新增 16191 行，把原来的【本地 agent CLI + 内嵌 Python harness】整体换成集群编排器。被删掉的那一代，工程形态和 DeskApp 几乎一一对应：

| 被删模块 | 行数 | DeskApp 对应物 |
|---|---|---|
| `internal/pythonsidecar/sidecar.go` | 430 | `resources/bridge.py` + `agents/desktop-agent.ts` |
| `internal/harness/{harness,stream}.go` | 63+68 | `agents/executor.ts` + `agents/event-bus.ts` |
| `internal/harness/antigravityinteractions/*` | ~2000 | bubble 的工具调用/审批/技能/cursor |
| `internal/skills/**`（registry + local + materialize/unzip） | ~1100 | `skill-hub/` |
| `cmd/ax/doctor.go` | 251 | 无对应物（setup wizard 里靠试错） |
| `cmd/ax/internal/display.go` | 474 | `bubble/ReasoningTimeline.tsx`、`task/StreamOutput.tsx` |
| `internal/controller/eventlog/{sql,sqlite,postgres}.go` | 118+56+57 | `session-store.ts` |
| `python/antigravity/harness_server.py` | 501 | `bridge.py` 的 stdio 协议 |
| `proto/content.proto` | 167 | `shared/agent-events.ts` |

所以本目录的取舍是：**现存的集群架构里挑"声明式规格 + 状态机 + runner 契约"这类可迁移的设计；被删的那一代里挑"本地进程 + python agent + 技能包 + 自检 + 终端显示"这类同形态的实现**。纯集群概念（atespace / CRD / Redis / gRPC / tunnel / gvisor / 多副本 controller）一律不迁移。

## 分册

| 分册 | 内容 |
|---|---|
| [01-borrow-list.md](01-borrow-list.md) | 现存架构里可迁移的设计：声明式规格、phase/condition、runner 契约、workspace 预热、队列/存储、CI（24 条） |
| [02-deleted-era.md](02-deleted-era.md) | 被删的「本地 agent 运行时」一代：python sidecar 生命周期、执行边界抽象、协议版本/错误码、技能注册表与安全解包、配置/自检/事件日志/装配/测试基建（20 条 + "AX 删掉换来了什么"） |

### 实施状态（2026-09-22 按 P0 顺序执行）

| # | 状态 | 落地与验证 |
|---|---|---|
| 1 | ✅ 完成 | `src/shared/task-state.ts`（TaskPhase/TaskCondition/setCondition/isTerminalPhase）+ 接线到 `shared/ipc-channels.ts:TaskTreeNode`、`agents/orchestrator.ts:TreeNode`、`bubble/TaskTreePanel.tsx`（补齐 suspended/terminating 图标）；`tests/task-state.test.ts` 5 例 |
| 2 | ✅ 完成 | `agents/bridge-protocol.ts`（PROTOCOL_VERSION/parseFrame/errorCodeOf）+ `resources/bridge.py`（emit 注入 `v`、error_frame+code、reasoning_end 于首个 text / tool_start / turn 结束三处边界）+ `desktop-agent.ts:parseLines`（版本不符只报一次并落 deadletter、error 按 code 分流）+ `onReasoningEnd` 打通到渲染层（ipc-channels/preload/ipc-handlers/useIpcStream/`lib/reasoningSegments.ts`/assembleTurns/buildReasoningEvents）；测试 `tests/bridge-protocol.test.ts`(6) + `tests/reasoning-segments.test.ts`(5)；真机一轮帧序列 `ready → 150×reasoning → reasoning_end → text → tool_start → tool_result → 41×reasoning → reasoning_end → 79×text → done` |
| 3 | ✅ 完成 | `desktop-agent.ts`：启动阶段 exit 立即 reject（带 exitCode + stderr 尾巴）、`killBridge` SIGTERM→3s→SIGKILL、`bootstrapPython` 按 bundle 指纹（runAgent.py mtime+size）跳过、`reapOrphanBridges()` + `recordBridgePid()`（`userData/bridge-pids`）；真机验证 `[DeskApp] reaped 1 orphan bridge process(es) from a previous run` 且目标进程确实被清掉 |
| 4 | ⚠️ 修正后并入 P1 | 原判断有误：**会话历史本来就持续落盘**（`renderer/src/bubble/hooks/useSession.ts:81-86` 每次 messages 变化都 `saveSession`），重开气泡还会用 `ipc-handlers.ts` 的 `sessions:open` 把已完成轮次 `injectContext` 回灌给新 bridge。真正缺的只是"进行中的 turn 可续跑"（需要 suspend 帧 + resume UI），不是 P0 的一行改动 → 归入 P1 第 8 项一起做 |
| 5 | ✅ 完成 | `src/main/doctor.ts`（6 项：engine bundle / python for engine / bridge processes 实测 rss·cpu·uptime / workspace 磁盘 / model config 读 `~/.hermes/config.yaml` + `.env` 有无 key / memory guard 最近采样）+ `doctor:run` IPC 四端注册 + `settings/ActivityTab.tsx` 自检面板 + zh/en 文案；真机经 CDP 调 `deskAppAPI.runDoctor()` → `ok = true`，6 项全 PASS（python 3.11.15 @ hermes venv、workspace 53GB free、deepseek + api key present） |
| 6 | ✅ 完成 | `.github/workflows/ci.yml`：`npm ci`（锁文件漂移即失败）→ `npm run build` → `npm run test`（PR/push main，actions 按 SHA pin、`permissions: contents: read`）+ `no-binaries` 任务（`git diff --numstat` 拦 `resources/`、`models/`、`icons/`、`docs/assets/` 之外的二进制）；js-yaml 解析通过、awk 规则用模拟 diff 实测能挑出 `src/main/foo.node` 而放过 `resources/uv/uv` |

## 优先级总表（我的判断，不是子代理的汇总）

排期依据是 DeskApp 现在的真实痛点，不是 AX 的功能完整度。

### P0 — 地基，改动小、收益立竿见影

| # | 项 | 为什么先做 | 落点 |
|---|---|---|---|
| 1 | 统一 `phase` + `conditions` 状态词表 | 现在三处各说各话（`TreeNode.status` 4 值、`AgentEventType`、`SpecStatus`），后面每一项改造都要先各自定义状态 | 新建 `src/shared/task-state.ts` |
| 2 | **bridge 协议版本号 + 错误码 + 类型边界** | `bridge.py` 的 `emit` 现在是裸 JSON、`error` 帧无 code、思考/正文无边界事件 —— 自检分流、setup-wizard 触发、渲染正确性全建在这三样上 | `resources/bridge.py`、`agents/desktop-agent.ts:parseLines`、`tests/mock-bridge.ts` |
| 3 | **sidecar 生命周期三件套（两个已核对的真问题）** | ① 启动阶段 python 崩溃不 reject，用户干等 30s（`desktop-agent.ts:461`/`:495-509`）；② 每次启动无条件 `uv venv` + `uv pip install -e`（`:709`）；③ `killBridge` 只有 SIGTERM 无 SIGKILL 兜底（`:364`） | `agents/desktop-agent.ts` |
| 4 | ~~气泡关闭不再丢 turn~~ 修正后并入 P1 | 原判断有误（见上方实施状态 #4）：已完成历史本就持续落盘并会在重开时回灌，真正缺的只是"进行中的 turn 可续跑" → 与 P1 #8 workspace profile 一起做 | `resources/bridge.py`、`src/main/vfs.ts`、`agents/desktop-agent.ts` |
| 5 | doctor 式一键自检 | 环境问题只能靠 setup wizard 试错；被删的 `doctor.go` 采样逻辑与 `BridgeManager` 几乎一一对应 | 新建 `src/main/doctor.ts` + settings 诊断页 |
| 6 | CI 门禁 | 现在 `.github/workflows` 只有 tag 触发的 `release.yml`，**push/PR 没有任何 build+test 门禁**；打包产物/大二进制误提交无防护 | `.github/workflows/ci.yml` |

### P1 — 结构性收益，需要动协议或存储

（实施状态：⑤ 版本化 spec 信封 ✅ 完成；⑥ runner 契约 ✅ 完成；⑦ 命名 ModelConfig ❌ 决定不做，见下；⑧ workspace profile ✅ 完成）

| # | 项 | 为什么 | 落点 |
|---|---|---|---|
| 5 | 版本化 spec 信封 + 严格校验 + legacy normalizer | 根治"gen-ui 生成的 spec 无版本、字段拼错静默落库" | `shared/gen-ui-types.ts`、`src/main/gen-ui.ts` |
| 6 | 把 `AgentExecutor` 从代码接口升级为进程契约（含自定义 runner） | 4 种后端（hermes/openclaw/claude-code/codex）各自为战，新增一种 = 新写一个 executor 类 | `agents/executor.ts`、`agents/cli-executor.ts`、`docs/runner-contract.md` |
| 7 | ~~命名 ModelConfig 实体~~ **不做** | 现有机制已经是等价物：planner/worker 槽位 → `setup:save-brain` 写 `~/.hermes/config.yaml`（`model.default` / `delegation.model`）+ `settings:update-models`。再引入一份 `models{}` 就是 AX 自己踩过的"同一配置两个来源"坑（`config.go` 的 `Antigravity.Default \|\| Registry.Antigravity.Default`，见 02 分册 §10-B6），收益是零、代价是两处漂移。真需要的是"cron/gen-ui 用哪个槽位"这种**路由一致性**问题，属偏好变更，等有明确需求再动 | — |
| 8 | Workspace profile 预热（git + skills + MCP 声明，marker 幂等） | 工作区现在只是一个空目录（`vfs.ts`），每轮靠 `context.ts` 重新组装 | `src/main/vfs.ts`、`agents/context.ts`、`skill-hub/` |
| 9 | 任务状态持久化 + 单队列 + 有界并发 | "崩溃/重启丢 turn""cron 与 scheduler 两套各自为政""并发无准入" | 新建 `agents/task-store.ts`、`agents/task-queue.ts` |

⑨ 的落地口径：**并发准入已做**（`src/main/turn-queue.ts`，全局 FIFO，`DESKAPP_MAX_TURNS` 默认 4；气泡 turn + cron + gen-ui + habit 摘要共用一个池；槽位在 turn 终态回调释放，30 分钟看门狗兜底）。**任务状态持久化没做** —— turn 落库需要先把执行链从"回调式 fire-and-forget"改成有句柄可恢复的形态，收益（崩溃恢复进行中的 turn）要等到有真实的多任务排队需求才值；现在崩溃丢失的只是进行中的那一条，历史已落盘。cron 与 scheduler 目前共用同一队列即可，不必合并成一套调度器。

⑧ 的落地口径（与 ax 的差异，刻意）：`vfs.ts` 新增 `WorkspaceProfile`（`.deskapp/workspace.json`，`name`/`goal`/`repos[]`）+ `workspaceRepoStatus()` + `ensureWorkspaceScaffold()`（marker `.deskapp/initialized-v1` 幂等，**只建目录**）。**DeskApp 不自己 clone**：agent 本来就有该 cwd 下的终端 + 审批流，app 内静默起网络请求是新增信任边界却零新增能力；profile 只声明期望，`context.ts:buildProfileBlock()` 把"缺哪些仓库"写进首轮快照让 agent 自己准备。skills 联动没做 —— hermes 认的是自己的 skills 目录，往工作区塞符号链接属于自造机制。待办：真需要"无人值守自动 clone"时再加（要有 URL 白名单 + 走风险等级审批）。

### P2 — 补齐体验与安全，设计成本更高

| # | 项 | 落点 |
|---|---|---|
| 10 | `watch` 语义（首帧快照 + 变化推送 + 终态收敛） | `agents/event-bus.ts`、`shared/ipc-channels.ts` |
| 11 | egress allowlist（工具层 host 白名单，未命中转审批） | `resources/bridge.py`、`trust.ts`、`grants.ts` |
| 12 | metadata 自省端点 + `readyz` 就绪语义 | `bridge.py`、`desktop-agent.ts`（修"气泡卡在 thinking"） |
| 13 | debug/attach 显式 opt-in（默认关） | `agents/runner-contract.ts`、img2threejs 控制台窗口泛化 |
| 14 | apply 幂等三态 + `get` 表格列 + `formatAge` | `cron.ts` 编辑入口、`scheduler/ProjectsView.tsx` |
| 15 | 技能源 = 注册表 + 本地目录的统一 `SkillGroup` | `skill-hub/store.ts` |
| 16 | IPC 通道按资源命名归并 + kind 归一容错 | `shared/ipc-channels.ts`、`ipc-handlers.ts` |

### P2 复核（2026-09-22 第二轮，读过代码后修正）

| 项 | 结论 |
|---|---|
| D4 可执行 e2e demo 脚本 | ✅ **已做**：`tests/e2e/smoke.spec.ts`（复用仓库已有的 playwright-core e2e 基建，不新建概念）—— 起真 Electron（隔离 userData）→ `runDoctor()` 逐项断言（engine bundle / python / workspace / model config / agent runners / memory guard 必须都在，防止改名静默丢检查项）→ 新 profile 下 workspace 检查必须报 `no profile` 而不是红 → 开气泡窗口成功。`npm run test:e2e` 通过（4 例，1.5s）。**刻意不含真 LLM 轮次**（费 token 且易 flake） |
| 02 §4.3 技能注册表安全解包（原被列为"先做的 3 项"之一） | ❌ **不适用，别做**：`skill-hub/` 只有本地目录扫描 + cursor 翻译，**没有任何解包/下载路径**（grep `unzip|extract|tar` 无命中），不存在"不可信 zip"这个攻击面，Zip-Slip/cap 无处安放。等真有远端技能源再一次性做齐四道防御 |
| 02 §4.2 `findSkillFile` 加 try | ✅ **已做**：`skill-hub/store.ts` 的 `findSkillFile` 改为 fail-safe 发现（`readdirSync`/`statSync` 各自 try + 逐条 skip），`getSkill` 的 `readFileSync` 也包了 try；`tests/skill-hub-discovery.test.ts` 用假 HOME + 悬空符号链接（坏 category + 坏技能文件 + 损坏的 index.json）断言"坏条目跳过、不抛、好技能照常找到" |
| 02 §6.1 doctor 实测子进程资源（`ps -p %cpu,rss,etime`） | ✅ **已做**：`mem-guard.ts` 新增 `measureRssMB(pid)`（`ps -o rss=`，python 无共享框架膨胀，RSS ≈ footprint），`sampleMemory()` 逐 bridge 实测、探测不到的 pid 才回落到 `BRIDGE_MB_ESTIMATE`（从 desktop-agent 导出，避免第二份常量），`bridgeManager.totalCount` 新增；压力阈值从此建立在实测上。测试：实测值覆盖常量、死 pid 返回 null |
| 02 §3.4 配置覆盖护栏（`NON_OVERRIDABLE` + 未知字段拒绝） | ❌ **不需要**：核过 `desktop-agent.ts:86` 的 `modelOverride` 只有 `{model, provider}`，`bridge.py:220-222` 的 `_resolve_override_model_config` 也只取这两个字段，api_key/base_url 一律从本地 `~/.hermes/config.yaml`/env 解析 —— **凭据从消息覆盖在结构上就不可能**，没有可防护的调用者。真出现"从消息带 endpoint"的需求时再一起补白名单 |
| A5 apply 三态 + `formatAge` + 列表列 | ⏳ 仍成立（小）：cron 就地编辑没有 created/configured/unchanged 反馈；缺统一 `formatAge` |
| B5 `ready`/`health` 拆分 + 元数据自省 | ⏳ 仍成立（中）：现在只有"进程活着"这一个信号 + 180s 首字超时，`HEARTBEAT_MS=24h` → "气泡卡在 thinking" 没有可观测信号 |
| B3 suspend/resume（关气泡丢进行中 turn） | ⏳ 仍成立（中大）：需要 suspend 帧 + 恢复 + UI 暂停态 |
| 02 §8 装配纪律（校验一律在 spawn bridge 之前） | ⏳ 仍成立（小）：`settings.validate()` + `assemble()` 单点，消灭"spawn 完才发现配置错" |
| A1 统一资源信封（跨 window spec / cron / model） | ❌ 不做：spec 已有 `schemaVersion`；再套 `apiVersion/metadata/status` 是 k8s 形式主义 |
| D2 IPC 命名归并（194 通道改名） | ❌ 不做：纯 churn，收益只有好看 |
| C1/C3/C4 task-store / reconciler / 两阶段删除 | ❌ 暂不做：等真实排队需求（见 ⑨ 口径） |

### 全量覆盖审计（AX 条目 × DeskApp 现状，2026-09-22 第三轮）

把 01（24 条）+ 02（25 条）逐条对齐后的完整矩阵 —— 有 ✅ 就不重复讨论，⏳ 是真空档，❌ 是判定不做（附理由）。

| AX 条目 | 状态 | 说明 / 落点 |
|---|---|---|
| A1 统一资源信封 | ❌ | k8s 形式主义，spec 已有 `schemaVersion` |
| A2 严格解码 + legacy normalizer | ⚠️ 部分 | 严格解码已做（`validateSpec(spec,{strict})` + `specUnknownFields` + `SPEC_SCHEMA_VERSION`）；**normalizer 未写** —— 现有 4 个 spec 文件顶层键全部合规，没有"旧 shape"可迁，等真出现旧数据再写（写了就是迁不存在的形态） |
| A3 `status.phase` + `conditions[]` | ✅ | `src/shared/task-state.ts` + 三处接线（P0 ①） |
| A4 命名 ModelConfig | ❌ | 与 hermes config.yaml 双来源冲突（⑦） |
| A5 apply 三态 + `formatAge` | ❌ **不适用**：三态的前提是"按身份 upsert"，DeskApp 的 cron 没有就地编辑（只有 create / enable 开关 / delete，`CronTab.tsx:24,74`），没有身份就没有"created/configured/unchanged"可报；创建失败的反馈本来就有（`CronTab.tsx:26` 显示 `r.error`）。`formatAge` 是 9 个文件里 13 处 `padStart(2,'0')` 的审美整理，无缺陷、改了还要重验 9 个界面 → 不做 |
| A6 `watch` + 单点 `setState` | ❌ | `orchestrator.ts` 每次变更全量 emit 是**有意为之**（渲染层习惯），并没有"写状态又触发自己"的反馈环 —— 为一个不存在的重入加一层 setState 门面是空转；真出现环再抽 |
| A7 / 02§4.1 统一 `SkillGroup` | ❌ | **只有一个产出方**（本地目录）；单实现抽接口是空转，等出现第二个源（远端注册表）再抽 |
| A8 PendingApproval/UsageStats 入 status | ❌ | 审批已有事件 + `ApprovalCard`，用量在 `agent-stats.ts`，预算告警在 `inbox.ts` —— 三者各得其所，合并只换来一层转换 |
| B1 runner 契约 | ✅ | `agents/executor.ts:RunnerSpec` + `docs/runner-contract.md` + doctor `agent runners` |
| B2 workspace profile | ✅ | `vfs.ts:WorkspaceProfile` + marker 幂等 + 首轮快照注入 |
| B3 suspend/resume | ⏳ | 关气泡丢进行中 turn，需 suspend 帧 + 恢复 + UI 暂停态 |
| B4 egress allowlist | ⏳ | 见下方"真漏洞"：cron 用 `autoApprove: true` 无人值守跑工具，这才是白名单真正的用处 |
| B5 `ready`/`health` 拆分 + 元数据自省 | ✅ **已做（心跳/首字看门狗部分）**：`bridge.py` 新增 `_turn_watch_tick` + 守护线程 —— 回合进行中每 15s 发 `health{phase:running,elapsed_ms,tool_calls}`；等待首字超过 `FIRST_OUTPUT_WARN_S`(120s) 改发 `health{phase:waiting_first_token,silent_s}` 并持续上报，超过 `FIRST_OUTPUT_TIMEOUT_S`(300s) 发 `error{code:'timeout'}` 结束该轮（进程继续，后续帧被已结束的主进程忽略）。**这修掉一个假声明**：`desktop-agent.ts` 原注释称"bridge-side first-output cap (180s) handles hung providers"，实际 `run_conversation` 无任何超时 → provider 静默时气泡会一直 thinking 到 24h 心跳。主进程侧 `case 'health'` 刷新 `lastHeartbeat`（任何帧=活着）+ 每轮只记一次首字等待；新增 `HEALTH_STALL_MS`(默认 60s，`DESKAPP_STALL_MS` 可调)：**任何帧都没有** 才告警（日志 + inbox），不杀（活着的轮次可能还会完成，超时裁决归 bridge）。验证：`test_bridge_watchdog.py` 19 项 ALL PASS（注入时钟直驱 `_turn_watch_tick`）；真机 app 日志出现 `bridge health: waiting_first_token` 且随后 `first token at 2899ms`。旋钮：`DESKAPP_HEALTH_TICK_MS`/`DESKAPP_FIRST_OUTPUT_WARN_S`/`DESKAPP_FIRST_OUTPUT_TIMEOUT_S`。**未做**：气泡状态行显示"等待中 Ns"（需新 IPC + i18n）、`readyz` HTTP 端点（桌面无 HTTP 元数据需求） |
| B6 debug/attach 显式 opt-in | ⏳ | `runner-contract.ts` 加 `debug:boolean`（默认 false）+ 旁观窗口泛化 |
| C1 level-based reconciler | ❌ | 等真实排队/恢复需求 |
| C2 单队列 + 有界并发 | ✅ | `src/main/turn-queue.ts`（气泡/cron/gen-ui/habit 共池，终态释放 + 看门狗）；**队列未持久化**（见 C3） |
| C3 `TaskStore`（memory + sqlite） | ❌ | 暂不做（⑨ 口径） |
| C4 两阶段删除 | ❌ | `TaskPhase.terminating` 已有词表，未接执行链 |
| C5 失败处理三原则 | ✅ | 坏任务不卡队列（deadletter ✓）+ 失败带 reason/message（TaskCondition ✓）+ 每个入口有终态兜底（abort handler 修复 ✓） |
| D1 `doctor` 自检 | ✅ | `src/main/doctor.ts`，7 项，含 runner 契约 |
| D2 命令形态 / CLI | ❌ | DeskApp 无 CLI |
| D3 CI 门禁 | ⚠️ | `.github/workflows/ci.yml` 已写并在本地用 js-yaml + awk 模拟验证，但**从未在 GitHub 上真实跑过**（需要 push，未授权）→ 首次 push 时盯着看 |
| D4 可执行 e2e demo | ✅ | `tests/e2e/smoke.spec.ts`（复用 playwright-core 既有 e2e 基建） |
| 02§1.1 PID 文件 attach-to-existing | ⏳ | 现在**选了相反的路**：`recordBridgePid` + `reapOrphanBridges` 下次启动直接 kill 残留。attach 需要握手复用协议，而 bootstrap 免重装后冷启已是秒级 → 收益不足以支撑握手协议的成本；保持"回收"是当前结论 |
| 02§1.2 就绪探测快速失败 | ✅ | 启动阶段 exit 立即 reject（exitCode + stderr 尾巴） |
| 02§1.3 SIGTERM→3s→SIGKILL | ✅ | `killBridge` 阶梯 |
| 02§1.4 bundle 免重装 | ✅ | bundle 指纹比对跳过 uv 安装 |
| 02§2.1 Harness 会话层三接口 | ❌ | `bridge.py` 已按会话串行 + `turn-queue` 已做准入；把 10 个回调收成一个 `Handler` 是接口审美，无行为收益且动的是最热路径 |
| 02§2.2 必须收到终态帧 | ⏳ | `done` / `error` / `proc.exit` 三条路收敛到一处 `endOnce` 守卫（现在靠 `taskDone` 自置空） |
| 02§3.1 帧版本 `v` + 未知字段容忍 | ✅ | `PROTOCOL_VERSION` + `parseFrame` |
| 02§3.2 错误码分流 | ✅ | `errorCodeOf` + bridge.py `_classify_error` |
| 02§3.3 类型切换边界 | ✅ | `reasoning_end` 真边界 → `reasoningSegments` |
| 02§3.4 配置 overlay 护栏 | ❌ | 核实后结构性不可能（override 只取 model/provider，密钥走本地 config） |
| 02§4.2 fail-safe 发现 | ✅ | `findSkillFile` fail-safe + `getSkill` try；`tests/skill-hub-discovery.test.ts` |
| 02§4.3 注册表安全解包 | ❌ | 无解包/下载路径，无攻击面 |
| 02§5.1 配置 version + validate + 恰好一个 default | ✅ **已做（校验部分）**：`setup-wizard.ts:validateSlot` —— provider `^[a-z0-9._-]+$`、model `^[A-Za-z0-9._:/@+~-]+$`、api_key 无空白、base_url 必须 http(s)（custom 必填）；两个写入口 `saveConfig`/`saveBrainConfig` 在**拼 YAML 之前**校验，非法即返回 `{ok:false,errors}` 且不落盘，错误透传到 `LLMTab`（复用 `testResult` 红字）与 `OnboardingCard`（`setError`）。真机验证：换行注入 / `ftp://` / 空 model 三种输入全部被拒，`~/.hermes/config.yaml` 的 sha256 与 mtime **未变**。测试 `tests/setup-config-validation.test.ts` 6 例。**这不是"形式校验"**：两个写入口是字符串模板拼 YAML，model 名带换行可注入任意配置键 —— 属信任边界修复。仍缺：settings 版本号字段 |
| 02§5.2 统一资产根 `paths.ts` | ⏳ | 无 `src/main/paths.ts`（已核）；`~/.deskapp`、userData、bridge-pids 路径散落 |
| 02§5.3 运行时 JSON overlay 编辑器 | ❌ | 现有设置表单够用 |
| 02§6.1 实测子进程资源 | ✅ | 每个 bridge 的 `rss / %cpu / etime` 用 `ps -p <pid> -o %cpu=,rss=,etime=` 实测（`doctor.ts:processRow`，**这一条一直都有**，我上轮审计表里说"doctor 不报"是写错了）；本轮补的是**总数**：`count × 135` 常量 → 逐 bridge `measureRssMB()` 求和、探测不到的才回落常量。真机（隔离实例+活 bridge）：`2 live (~343MB measured) — 1: 177MB rss… \| spare: 166MB rss…`，177+166=343 ✓（旧算法会说 270MB） |
| 02§6.2 display 状态机 | ❌ | 渲染层已是事件驱动，不适用 |
| 02§7 事件日志 `step` + 事务 | ❌ | `busy_timeout = 3000` 已有；`step` 单调列的唯一消费者是"事件重放/续跑"，而 B3（suspend/resume）才是它的需求方 —— 需求没来之前加列 = 迁不存在的东西（要做 B3 时一起做） |
| 02§8 装配纪律（校验先于 spawn） | ❌ | 本轮 02§5.1 已把校验放在**写配置的入口**（更靠前），"spawn 完才发现配置错"的路径已经不存在；再抽 `assemble()` 单点没有对应缺陷 |
| 02§9 mock bridge / 纯函数帧解析 | ✅ | `parseFrame` 纯函数 + `tests/mock-bridge.ts` + `tests/bridge-protocol.test.ts` |
| 02§10-B 反面教材六条 | ✅ | 已按条目核对（假客户端、审批塞 union、凭据覆盖、文本指针注入技能、拉取无 deadline、同一配置两来源）均未复现 |

**审计出的安全问题（唯一一条，已修可见性 + 余下待决）**：`cron.ts:134-136` 会给定时任务装它声明的 `standing_grants`，但 `cron.ts:157` 同时传 `autoApprove: true` → `bridge.py:319` 的 `_deskapp_approval_callback` 直接 `return 'once'`。准确后果：

- 无人值守时的闸门**只剩 hermes 自己的危险命令分类器**（DeskApp 侧不看 RiskClass；`standing_grants` 在自动放行下也失效）。
- 审批卡不会弹，`APPROVAL_TIMEOUT_S=120` 的"自动 deny"也**永不触发**（那条路径只服务气泡）。
- 因此一次无人值守的工具调用在 DeskApp 侧**不留任何痕迹**（没卡、没 inbox、没审计）。

✅ 已修（可见性，零行为变更）：`bridge.py` 在自动放行前 `emit auto_approved`（命令/描述经 hermes 预脱敏），`desktop-agent.ts` 的 `parseLines` 新增 `case 'auto_approved'` → 审计 JSONL（`userData/audit/`，走既有 `sanitizeForAudit`）+ console；刻意不落 inbox（一个任务能放行几十次，会变成噪音）。验证：`/usr/bin/python3 test_bridge_approval.py` → ALL PASS（新增 5a-5d：返回 once、帧发出、字段完整、未弹卡）。

⏳ 未做（要你拍板，因为会改行为）：是否给无人值守路径加**真正的闸门** —— 按 B4 在工具层解析 host 做 allowlist，未命中提升 RiskClass 落 inbox 待批；或最简版"cron 任务只允许 `standing_grants` 内的工具，其余一律 deny"。现在收紧可能打断你已有的定时任务（例如 intelhub 类抓取），所以默认不动。

## 不建议借鉴（附理由）

1. **Redis Streams / consumer group / PubSub / `TxPipeline` / ZSet 索引**（`internal/store/redis/store.go`）：为"百万级短生命周期任务 + 多副本 controller"设计；DeskApp 单用户单主进程，`claimed_at + 超时回退` 一列就能等价 reclaim，引入 Redis 只增加部署面。
2. **gRPC + protobuf + protojson 单一事实源 + YAML 桥接**（`pkg/apis/v1alpha1/types.go:44-156`）：纯为 K8s manifest 服务；DeskApp 用 TS union type 做单一事实源即可。
3. **CRD / etcd / atespace / namespace / kube context / `ax tunnel`**（`internal/tunnel/*`、`cmd/ax/main.go:runTunnel`）：连远端 K8s 的机制,桌面无对应场景。**只保留一条结论**：DeskApp 不该把状态放进"需要运维的控制面"。
4. **Agent Substrate 的 ActorTemplate / gvisor / 快照卷机制**（`internal/substrate/client.go`）：桌面无多租户无调度，进程级管理已够。**只借"agent 状态与工作区文件分离"的思想**，以及 `SNAPSHOT_CONTENT_SCOPE_DATA` 式的"哪些数据必须活过重启"分类。
5. **容器镜像分发（`ko`、`.ko.yaml`、`Dockerfile.task-runner`、`make build-task-runner`）**：DeskApp 是 Electron 打包。
6. **Antigravity 模型驱动预置**（`internal/workspace/planner.go:PlanEnvironment`、`cmd/ax-task-runner/antigravity_bootstrap.py`）：DeskApp 已经有 hermes 当 agent，预置用确定性脚本（git clone + 技能软链）更可预测；要"智能预置"就让 hermes 第一轮自己干。
7. **lipgloss TUI 展示层**（已删的 `cmd/ax/internal/display.go`）：展示逻辑属于 `src/renderer`。
8. **OTel 遥测**（已删 `internal/telemetry/telemetry.go`）、**CLA/法务流程**（`CONTRIBUTING.md` 前半）、**mascot 规范**（`docs/logo.md`）：与工程无关。
9. **AX 自己的两个反面教材**：① phase 除以外的取值全是裸字符串（只有 `PhaseTerminating` 是常量，`types.go:41`）→ DeskApp 要用枚举常量对象；② `WatchTask` 在 phase 落到 `Running` 就关流（`internal/server/server.go:233`）是为 CLI "跑到 Running 即退出"定制的语义,DeskApp 的 turn 是持续流,别照抄。

## 溯源与验证

- 本目录所有 `file:symbol` 引用均由主进程实际打开对应文件核对过（`pkg/apis/v1alpha1/types.go`、`internal/{controller,store,workspace,metadata,substrate,guest,model,tunnel}`、`runner/runner.go`、`cmd/ax/**`、`docs/**`、`.github/workflows/**`、`Makefile`）。
- 已删除文件的行号来自 `git show dc4f36c --stat` 与 `git show dc4f36c^:<path>`。
- 标注"未验证"的点：`EgressAllowlist.Hosts` 元素类型名（只确认了 `.Host` 字段存在于 `internal/substrate/client.go`），以及其他分册里显式标注的项。
