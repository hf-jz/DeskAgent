# AX 被删掉的「本地 agent 运行时」一代 → DeskApp 借鉴清单

来源：`git show dc4f36c^:<path>`（commit `dc4f36c` 重构前）。scope 内 36 个文件、约 6480 行。
这一代的工程形态与 DeskApp 一一对应（本地进程 + python sidecar + 技能包 + 配置 + CLI 显示），AX 删它是因为转向集群，**不是因为设计不好** —— 所以这里的条目普遍比 `01-borrow-list.md` 里的集群版更贴地面。

DeskApp 侧引用的 `file:symbol` 均已打开核对；对子代理结论我做了两处修正，见各条末尾的"核对"。

---

## 1. Python sidecar 生命周期（`internal/pythonsidecar/`）

### 1.1 PID 文件重连（attach-to-existing）—— DeskApp 完全没有
**AX**：`sidecar.go:Sidecar.Start` 先读 `~/.ax/sidecar.pid`：若该 PID 存活且 `ReadyFunc` 探测通过 → **不 spawn，直接 attach**（`s.cmd=nil`、复用 pid、起 `monitor()` 轮询）；否则 `cleanPID` 后 spawn。`isAlive` 用 `Signal(0)`（`err==nil || EPERM` 视为活）；`writePID` 先 `MkdirAll`；`cleanPID` 只在 pid 匹配时才删（不误删别人的）。
**DeskApp**：`desktop-agent.ts:419 spawnBridge` 无条件 `spawn(this.pythonBin!, [bridgeScript], {...})`；Electron 崩溃重开后，之前遗留的 python bridge 进程既不接管也不清理（靠 SingletonLock 保证单实例，但 bridge 不是）。
**落地**：`spawnBridge` 前写/读 `~/.deskapp/bridge.pid`：`kill -0` 判活 + 发一个 ping 帧探测 → 复用则直接接管（省 5-15s 冷启），否则清 pid 再 spawn。

### 1.2 就绪探测 + 快速失败（当前是真 bug）
**AX**：`ReadyFunc` 是可注入探测（默认 `TCPReady`），`WaitUntilReady` 每 50ms 轮询，**先查进程是否提前退出**（返回 `exitErr`）再跑探测，`ctx` 取消即返回；失败路径都 `Stop()` + `%w` 包裹错误（区分 spawn 失败 / 就绪失败）。
**DeskApp**：`desktop-agent.ts:495-509` 的就是 `setInterval(check,50)` + `setTimeout(…30000)`，超时抛 `'Bridge start timeout (30s)'`。
**核对**：我查了 `proc.on('exit')`（`desktop-agent.ts:461`）——它只处理 `state==='running' && taskDone` 的崩溃通知，启动阶段的 exit 只把 `state` 置 `idle` 并 return，**不会 reject 启动 Promise**，所以 python 立刻崩溃时用户要干等 30s 才看到超时。子代理结论成立。
**落地**：`check` 轮询里加"`proc.exitCode !== null` → 立即 reject，错误里带 exitCode + 最近 N 行 stderr"；错误分成 `bridge.py not found` / `spawn error` / `start timeout` 三类（也让 1.3 的 `no_credentials` 分流有地方落）。

### 1.3 SIGTERM → 3s → SIGKILL 阶梯
**AX**：`sidecar.go:Stop` 发信号后 `select { <-done; <-time.After(3s) }`，超时补 SIGKILL。
**DeskApp**：`desktop-agent.ts:364 killBridge()` 只有 `this.proc.kill('SIGTERM')`，无兜底 → python 卡在不可中断的 C 调用（如某个 SDK 阻塞）就留僵尸，正好会吃掉 `mem-guard` 的内存预算。
**落地**：SIGTERM 后 3s 若 `exitCode === null` 再 `SIGKILL`。

### 1.4 资产抽取"已装则跳过"（size/hash 比对）
**AX**：`setup.go:setup` 的 `extractFS` 写盘前比对 `os.Stat(dest).Size() == info.Size()` 跳过（保 timestamp，避免 `updated=true` 触发重装）；只有真有文件更新才重跑 `pip install`。
**DeskApp**：`desktop-agent.ts:709 bootstrapPython` 每次启动都无条件 `uv venv --python 3.12` + `uv pip install --python venv/bin/python3 -e agentSrc`（超时 120s/300s）。
**核对**：确认无条件、无版本标记、无"已存在则跳过"。
**落地**：在 `deskapp-agent-venv/.bundle-version` 写 hermes-agent 的 bundle 版本/git hash，一致就跳过整段 bootstrap。**这条是"每次启动的秒级节省"，风险最低。**

---

## 2. 执行边界抽象（`internal/harness/`）

### 2.1 `Harness / Execution / Handler` 三接口 + 单写者约定
**AX**：`Handler{OnMessage(ctx, execID, *Step), OnComplete(ctx, execID)}` 把"流式事件消费"收成两个纯回调，与传输（gRPC/stdio）解耦；`Harness.Start(ctx, conversationID, config []byte) (Execution, error)` —— **config 是不透明字节**，由实现自己解释；`Execution{Run(ctx, handler), Queue(ctx, steps...), ID(), Close(ctx)}` —— `Queue` 允许先囤积输入再 `Run` 一次消费。注释明确的 **single-writer 约定**：同一 conversation 同时最多一个 Execution，实现据此可用 last-write-wins 而不需要 CAS。
**DeskApp**：`agents/executor.ts:9 AgentExecutor` 只有 `execute(task, cbs)`；`TaskStreamCallbacks` 是 10+ 个散回调（`onChunk/onReasoning/onToolCall/onTokens/...`）；没有"会话/Execution"概念；per-task 配置塞在 `execute` 第 4 参 `modelOverride` 里；队列能力在主进程（`desktop-agent.ts` 的 `QueuedTask[]`），python 侧没有"一次 run 消费一组输入"的语义。
**落地**：`executor.ts` 增加会话层 `start(conversationId, configJson) → queue(task…) → run(handler) → close()`；`TaskStreamCallbacks` 内部保留、对外收成 `Handler{onMessage, onComplete}`；`config` 从 `execute` 参数里抽出来变成 `start` 的不透明 JSON（正好接第 5.4 条）。

### 2.2 "必须收到 End 帧"的纪律
**AX**：`stream.go:DrainStream` 循环 `Recv` 直到 EOF，捕获 `HarnessResponse_End`；**流结束但没收到 End 帧 → 报错** `"harness stream ended without HarnessEnd frame"`；`End.State==FAILED` 时把 `Error{code, description}` 转成 `"harness failed: [code] description"`。
**DeskApp**：终态是 `done` 帧，异常是 `error` 帧，另外 `proc.on('exit')` 里还有一条 `taskDone(false, 'Bridge exited unexpectedly')` 兜底 —— 三条路径都能落 `taskDone`，靠 `taskDone` 自置空来避免重复（`desktop-agent.ts:461-480`）。
**落地**：把"turn 终态"变成一个显式概念：`parseLines` 里加 `endOnce` 守卫（`event-bus.ts` 已有同模式），进程 exit 时若未收到终态帧才合成 `error`（带 exitCode）；`done`/`error`/`exit` 三条路径收敛成一处。

---

## 3. 协议层（`proto/content.proto` + `python/antigravity/harness_server.py`）

### 3.1 每条消息带版本号（`v`）+ 未知字段容忍
**AX**：`Content` 是 protobuf `oneof`（text/image/audio/document/video/confirmation），字段大量用 `reserved` 标废弃；`sql.go` 读旧日志时用 `protojson.UnmarshalOptions{DiscardUnknown: true}` 保证**前向兼容**。
**DeskApp**：`resources/bridge.py:29 emit(d)` 直接 `json.dumps` 写 stdout，**无版本字段**；`desktop-agent.ts:parseLines` 按 `ev.type` switch，加字段时旧主进程静默丢字段。
**落地**：`emit` 统一注入 `v: 1`；主进程 `parseLines` 开头判 `ev.v !== 1` → 记 `deadletter.ts` 并忽略；配套 `resources/bridge-schema.json`（JSON Schema）+ 扩充现有 `test_bridge_spawn.py`/`test_bridge_approval.py` 做 conformance 断言（仓库已有 pytest 基建，不引入新框架）。

### 3.2 错误码（决定失败分流）
**AX**：所有失败都 yield `HarnessEnd{state=FAILED, error=Error{code, description}}`，code 用标准码（3=INVALID_ARGUMENT、9=FAILED_PRECONDITION、13=INTERNAL），每个失败点各自精确。
**DeskApp**：`bridge.py:710 emit({'type': 'error', 'message': str(e)})` —— **无 code**；主进程只能看字符串，无法区分"配置错/无凭据/provider 报错/内部错"，于是 setup-wizard、重试、inbox 都只能瞎猜。
**落地**：`error` 帧加 `code`，常量集 `invalid_config | no_credentials | provider_error | timeout | internal`；`parseLines` 的 `case 'error'` 按 code 分流：`no_credentials` → 触发 `setup-wizard`；`invalid_config` → `deadletter`；`provider_error` → `cbs.onError` + 重试提示。**这是 `01-borrow-list.md` 里 doctor/自检能落地的数据基础。**

### 3.3 流式缓冲 + 类型切换边界（消除"思考/正文粘连"）
**AX**：`harness_server.py` 在 `async for chunk in response.chunks` 里把连续 `Text`/`Thought` **缓冲**，直到类型切换或遇到 `ToolCall` 才 flush 成一条 `HarnessOutputs`；`flush_thought` 还会 `re.sub(r"\n{3,}", "\n\n")` 折叠 + `rstrip()` + 补尾换行（因为下游 display 的换行过渡只补一个）。
**DeskApp**：`bridge.py:627 on_text` 每个 delta 立刻 `emit({'type':'text','content':delta})`；`on_reasoning`（`:205`）同样立刻 emit `{'type':'reasoning'}`。**没有类型切换边界事件**，于是渲染层 `bubble/ReasoningTimeline.tsx` 只能靠"下一条 text 到了"反推思考结束。
**落地**：`bridge.py` 加一个"当前流类型"状态位，切换时先发 `{'type':'reasoning_end'}`（或把 reasoning 合并成单帧）再发 text；`agent-events.ts` 加对应 `reasoning.end` 事件，`ReasoningTimeline.tsx` 不用再猜。

### 3.4 配置 overlay 的三条护栏
**AX**：`harness_server.py:_build_config_for` —— ① `_NON_AGENT_CONFIG_FIELDS = {"conversation_id", "save_dir"}` 标记**不准被覆盖的托管字段**；② `_reject_disallowed_fields` 拒绝托管字段与**未知顶层字段**（防 typo 被静默吞）；③ overlay 请求 JSON 后**把托管字段强制写在最后**，再用 `LocalAgentConfig(**values)` 重建以触发 SDK 重新校验。
**DeskApp**：`bridge.py:_get_model_config` / `_resolve_override_model_config` 是"读 config.yaml → 每任务覆盖 model/provider"的平铺逻辑，无托管字段边界、不拒未知字段（写 `baseurl` 会被静默忽略）。
**落地**：`bridge.py` 定义 `NON_OVERRIDABLE = {"session_id", "hermes_home", "api_key"}`（**凭据永远不能被任务消息覆盖** —— AX 自己在 `_NON_AGENT_CONFIG_FIELDS` 留了 TODO 说这块没做完，别继承它的缺口），未知字段 → `error{code:'invalid_config'}`。

---

## 4. 技能系统（`internal/skills/`）

### 4.1 来源无关的 `[]SkillGroup` 结果形状
**AX**：`skills.Group{Dir, Skills []Skill{ID, Dir}}`；本地发现与注册表拉取**产出同一个形状**，下游（system instruction 构建器）不依赖具体来源包。约定：每个技能是 `<Dir>/<skill-id>/SKILL.md`。
**DeskApp**：`skill-hub/store.ts` 用 `SKILL.canonical.md` + `index.json` 的单一格式，`translator.ts` 转成 hermes 的 `SKILL.md` 写死到 `~/.hermes/skills/{category}/{name}/SKILL.md`。
**落地**：`skill-hub/types.ts` 加 `SkillGroup{dir, skills:{id,dir}[]}`，让 store（本地）、内置安装、未来 registry 三者都产出 `SkillGroup[]`，`translator.ts` 只消费它。

### 4.2 fail-safe 发现（一个坏路径不能阻塞）
**AX**：`local.Discover` —— `!Enabled` 跳过；`ReadDir` 失败 / 非目录 / 无 `SKILL.md` 都 `log` + continue，**坏路径绝不阻塞 harness 创建**；非技能条目静默跳过（不产生日志噪音）。
**DeskApp**：`skill-hub/store.ts:220 findSkillFile` 里 `statSync(catDir).isDirectory()` 与 `readFileSync` **无 try** → 断链/权限错误会抛。
**核对**：批量同步那侧是安全的 —— `syncAllToHermes`（`store.ts:322-325`）对每条调 `syncToHermes(name)` 收 bool，失败进 `failed[]`，不会中断其他技能。所以差的只是**发现/读取路径**的 try。
**落地**：`findSkillFile`/`loadSkill` 加 try（失败 `log` + skip），`settings-store.ts` 的 skills 配置改成枚举式 `[{enabled, path}]`（对齐 AX 的 `SkillsConfig{Registries, Local}`）。

### 4.3 注册表拉取 + 安全解包 + first-wins（整体可移植）
**AX**（`geminienterprise/{client,materialize,unzip}.go`）：
- `client.go:selection` 三模式 `All / SkillRefs[{SkillID, Revision}] / Query{Text, TopK}`，`fetch` 单技能失败进 `skipped` 不整体失败；
- `materialize.go:claimSet` 用 `(target_dir, skill_id)` **first-wins 去重**（多注册表共用一个 target dir 时先写者赢，后者 skip + warn）；
- `unzip.go:safeUnzip` 对**不可信 zip** 防御：Zip-Slip（`..`/绝对路径/symlink 拒绝）+ `MaxFiles=10000` + `MaxTotalUnzippedBytes=500MiB` + `MaxDepth=8`；`writeCappedFile` 用 `io.LimitReader(remaining+1)` 防"谎报未压缩大小"；解包后 `chmod` 保留 scripts 可执行位；
- `fetchAndWrite` 先 `os.RemoveAll(skillDir)` 再解包（不留陈旧文件），失败清半成品。

**DeskApp**：`skill-hub` 没有"远端拉取 → 解包 → 去重 → 版本 pin"的能力；内置技能靠脚本 `resources/install_builtin_skills.py`。
**落地**：新建 `src/main/skill-hub/registry.ts`（`fetch → safeUnzip → claimSet`）。解包用 Node 手写 `yauzl` 流式实现或复用已装依赖，但**四条防御必须齐**：Zip-Slip、文件数/总字节/深度三重 cap、"已写入字节"实计而非信头。**AX 自己留了 TODO（拉取串行、无总 deadline）—— 我们加并发上限 + 总超时，别把它的坑一起搬来**（`# ponytail: 并发 2 + 总超时 60s，多注册表实测慢再加`）。

---

## 5. 配置（`internal/config/config.go` + `cmd/ax/agentconfig.go`）

### 5.1 配置版本号 + oneof 校验 + "恰好一个 default"
**AX**：`Config.Version`（yaml `version`）显式版本化；`SkillsRegistryConfig.validate` 用计数强制 `All/Refs/Query` 三选一；`Config.Validate` 里 `defaultCount > 1` 报 "multiple harnesses marked as default"；保留 ID/命名空间被内置占用时报错。
**DeskApp**：`settings-store.ts` 是 JSON，无 version 字段，无 oneof 校验，没有"恰好一个 default executor/model"的校验。
**落地**：`settings-store.ts` 加 `version` + `validate()`（provider 名非法 / 缺 key / 缺 base_url 报具体字段），并把"恰好一个 default"作为规则（模型实体见 `01-borrow-list.md` A4）。

### 5.2 统一资产根 helper
**AX**：`AXAssetsDir()` 用 `AX_DURABLE_DIR` 或 `~/.ax` 收拢资产/状态路径。
**DeskApp**：`~/.deskapp`、`userData`、`WORKSPACE_DIR` 的路径拼接散落在 `vfs.ts`/`desktop-agent.ts`/`settings-store.ts`/`habit/`。
**落地**：加 `src/main/paths.ts`（`assetsDir()` / `bridgePidFile()` / `bridgeStateFile()`），顺手给 1.1/1.4 的 pid 与 version 文件一个统一落点。

### 5.3 运行时 JSON overlay + 校验循环（编辑器交互模式）
**AX**：`agentconfig.go` 的 `/config` 菜单 → 打开 `$EDITOR` 预填当前 config → `normalizeAgentConfigJSON` 校验（必须是 object，空则清空），**非法 JSON 报错并带着用户的草稿重开编辑器**；`prettyAgentConfig` 用 `json.Indent` 美化。
**DeskApp**：模型/agent 配置在设置表单里改，没有"配置是一个可编辑、可校验、可 load from file 的 JSON blob"这个实体；`bridge.py` 的 `modelOverride` 只覆盖 model/provider。
**落地**：`settings-store.ts` 暴露 `getAgentConfig()/setAgentConfig(json)`；`settings/LLMTab.tsx` 加"查看/编辑 JSON / 从文件加载"，错误时保留草稿；`bridge.py` 的 `task` 消息加可选 `agent_config`（JSON 字符串，对齐 `HarnessStart`）。

---

## 6. 自检与显示

### 6.1 `doctor.go` 的 `Stats` 采样（同 `01-borrow-list.md` D1，此处补细节）
**AX**：`ps -p <pid> -o %cpu,rss,etime,command` 采样子进程 + `net.DialTimeout(120ms)` 探 endpoint + `python3 --version` + Go runtime 内存/goroutine + assets 文件数/大小。
**DeskApp**：`agents/desktop-agent.ts` 的 `stats()` 只有 busy/lastUsed/pinned；`estimatedMemoryMB()` 是我上轮加的**常量估算** `BRIDGE_MB=135`，不是实测；ActivityTab 看不到子进程真实资源。
**落地**：`src/main/doctor.ts` 用 `ps -p <pid> -o %cpu=,rss=,etime=` 实测每个 bridge，替换常量估算（`mem-guard` 的压力判断随之从"估算"升级为"实测"）；`Sample()` 结构化输出喂 ActivityTab。

### 6.2 `displayState` 状态机 —— 借鉴点在协议层，不在渲染层
**AX**：`display.go` 用 `displayState ∈ {none, text, thought}` 记住"上次打印的类型"，在切换时补换行；`Display(step)` 按 `Step_Content/Thought/ToolCall/ToolResult` 分派（`🛠 name(args)`、`❌ Tool Error (name)`）；渲染是纯 `io.Writer` 函数，与传输解耦。
**DeskApp**：渲染层已是纯 AgentEvent 驱动（`bubble/ReasoningTimeline.tsx`、`task/StreamOutput.tsx`），**不需要搬 TUI 代码**；真正缺的是 3.3 说的"类型切换边界事件"在源头就丢掉了。
**落地**：只做 3.3（协议层补 `reasoning_end`），渲染层不动。

---

## 7. 事件日志（`internal/controller/eventlog/`）

**AX**：`EventLog.Append/Events/Close` 是 append-only 事件日志，**replay 即恢复**；`sql.go:Append` 在同一个事务里 `SELECT COALESCE(MAX(step),0)+1 FROM conversation_log WHERE conversation_id=$1` 再插入（`(conversation_id, step)` 主键，并发安全）；读旧日志 `DiscardUnknown: true` 前向兼容；`sqlite.go` 的 DSN 带 `_busy_timeout(10000)&_txlock=immediate` 防锁。
**DeskApp**：`session-store.ts:39` 只有 `sessions` + 消息表，无 per-conversation 单调 step，无 replay 语义；`bridge.py:_trim_history` 在 python 侧按 token 估算裁剪，与 SQLite 里的原始消息是两套事实。
**落地**：`session-store.ts` 的消息表加 `step INTEGER`（事务内 `MAX(step)+1`，`BEGIN IMMEDIATE` + `busy_timeout`）；读 JSON 时容忍未知字段。这直接给 `01-borrow-list.md` B3（suspend/resume）提供"权威序号"。

---

## 8. 组合根 / 装配（`cmd/ax/internal/cliutil/cliutil.go`）

**AX**：`NewControllerFromConfig` 一个函数完成全部装配，顺序是 **先 `validate` 配置 → 再解析技能（registry + local 都 append 到同一个 `groups`）→ 再构造 harness（fork sidecar）** —— 源码注释明确"validate before local-mode antigravity.New forks the Python sidecar"，即**任何校验都发生在 spawn 子进程之前**；默认 harness 解析规则是"显式 Default → 否则内置"。
**DeskApp**：`agents/manager.ts` 探测 + 装配，技能解析（`skill-hub`）、executor 选择（`detect-*`/`cli-executor`）、会话存储（`session-store`）散在多个模块；`context.ts:buildCatalog` 负责把技能塞进 prompt，但"技能从哪来"与它脱节。
**落地**：`manager.ts` 增加 `assemble()`：`settings.validate()` → 解析 `SkillGroup[]`（本地+内置+注册表统一）→ 选默认 executor → 把 `SkillGroup[]` 交给 `context.ts:buildCatalog`。纪律：**校验一律在 spawn bridge 之前**（这条能直接消灭"spawn 完才发现配置错"的一类问题）。

---

## 9. 测试基建（`internal/harness/harnesstest/`）

**AX**：`MockHarnessServer` 在进程内起 gRPC 服务，记录收到的 start 帧，按配置回放 `Outputs`/`FailConnect`/`FailFrame`，末尾发 `HarnessEnd{COMPLETED/FAILED}`；`MockHandler` 记录收到的 steps；`UserStep/AssistantStep/ThoughtStep` 构造器 —— **整个 harness 协议可无 agent、无网络地端到端测**。
**DeskApp**：`test_bridge_spawn.py`/`test_bridge_approval.py` 是真 spawn bridge.py 的集成测试（慢、依赖本机环境）；`parseLines` 的"帧 → 回调"映射内嵌在 `spawnBridge` 的 stdout 回调里，无法单测。
**落地**：先把 `parseLines` 抽成纯函数 `parseFrame(ev, cbs)`（零依赖、可测），再写 `tests/mock-bridge.ts` 回放 `ready→text→reasoning→tool_start→permission_required→done/error` 帧，覆盖 3.1/3.2/3.3 的协议改动（vitest 已就位，`npm run test` 即可）。

---

## 10. AX 自己删掉这些，换来了什么（避免重踩）

**A. 因为"转向集群"而删 —— 目标变了，不是设计不好，正是 DeskApp 该学的**：
`pythonsidecar`（PID 重连 + 就绪探测 + 优雅退出）→ 被 `runner/` + 沙箱 worker 替代；`harness` 三接口 → 被 `runner`/`model client` 替代；技能 registry 拉取 + 安全解包 → 集群版不再管（技能改由 Workspace 声明）；`doctor` → 删除（集群侧改用 observability）；`eventlog`（SQL 事件日志）→ 被 Redis 替代（commit 原文："Task state now lives in Redis rather than CRDs…handle millions of short-lived tasks"）。

**B. 因为"设计不好 / 半成品"而删 —— 这些是坑，别抄**：
1. `cmd/ax/harnessclient.go` 文件头自己写 `TODO: Update or replace this file with ax client implementation` + "intended for testing purposes only" —— **占位假客户端混进产品路径**。别留 `TODO: replace` 的 fake 实现。
2. `content.proto` 的 `Content.confirmation` 自带 `TODO(jbd): Remove out of the Content and replace it with ElicitationStep` —— **把审批塞进内容 union 是作者自己承认的错**。DeskApp 现在把 permission/question 做成独立事件类型（`agent-events.ts` + `bubble/ApprovalCard.tsx`）是对的，别倒退成"一个扁平流里 switch"。
3. `_NON_AGENT_CONFIG_FIELDS` 的注释 TODO："add validation for fields that are unsafe to set per execution (e.g. credentials, deployment routing)" —— **凭据/路由的覆盖校验没做完**。DeskApp 的 `modelOverride` 现在就能覆盖 provider/base_url，必须显式禁止覆盖 api_key（见 3.4）。
4. `antigravityinteractions/skills.go:SkillsSystemInstruction` 是"harness 没有 SKILLS_DIR 概念，只能把技能路径拼进 system instruction 让内置 file 工具去读"的**退而求其次** —— 别把"文本指针注入技能路径"当方案，要做真发现（4.1/4.2）。
5. `geminienterprise/materialize.go` 两个 TODO：拉取串行、没有总 deadline → 我们做 registry 时必须补（4.3）。
6. `config.go` 里 `AntigravityHarnessConfig` 与 `Registry.Antigravity` **两个字段并存且都要判 Default**（`if c.Antigravity.Default || c.Registry.Antigravity.Default`）—— 同一配置两个来源的重构中间态。DeskApp 的模型配置（`task-router.ts` 的两条路由 + settings + LLMTab）是同类重复，要**收敛成一个实体**，不要让它并存。

---

## 先做的 3 项（我的排序）

1. **`bridge.py` 协议加 `v` + 错误码 + `reasoning_end`（第 3 章）** —— 一切的地基：自检要靠错误码分流、`setup-wizard` 要靠 `no_credentials`、渲染要靠类型边界、前向兼容要靠 `v`。改动集中在 `emit`/`parseLines` + 一个 schema 文件。
2. **sidecar 生命周期三件套（第 1 章）** —— PID 重连 + 就绪快速失败 + SIGKILL 阶梯 + bootstrap 免重装。**其中"启动阶段 exit 不 reject、要干等 30s"与"每次启动无条件重装 venv"是我核对过的现存问题**，纯主进程改造，收益立刻可见（省秒级启动 + 少一类假超时）。
3. **技能 `SkillGroup[]` + registry 安全解包（第 4 章）** —— 补 `skill-hub` 的真实缺口，但要带上 AX 自己缺的并发上限与总超时。
