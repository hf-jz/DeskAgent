# Runner contract

DeskApp 的"runner"就是真正跑 agent 的那个东西。控制侧（Electron 主进程）**不硬编码** runner 怎么工作，只依赖这份契约 —— 这是从 google/ax 的 `docs/runner.md` 借来的分工（见 [ax/01-borrow-list.md §B1](ax/01-borrow-list.md)，ax 的 8 条 checklist 是同一思路）。

契约在代码里的载体是 `src/main/agents/executor.ts` 的 `RunnerSpec`：每个 executor 用 `spec()` 自我描述，doctor 的自检项 `agent runners` 直接读它，所以契约不会和实现漂移。

## 目前的 runner

| id | 启动方式 | 就绪信号 | 协议 | 工作目录 | 可 attach |
|---|---|---|---|---|---|
| `desktop-agent` | child-process: `python3 resources/bridge.py` | stdio 帧 `{"type":"ready"}` | JSONL v1 | 工作区目录（`vfs.getWorkspaceDir()`） | 否 |
| `hermes-gateway` | daemon: `hermes`（gateway） | 进程存活 + HTTP 探测 | 非 stdio | 进程 cwd | 否 |
| `claude-code` / `codex` / `openclaw` | child-process: `claude -p` / `codex exec` / `openclaw run` | 二进制存在 | 纯文本 stdout | 进程 cwd | 否 |

## 一个 runner 必须做到什么

1. **启动**：被控制侧用固定命令拉起；任务内容通过 stdin（stdio runner）或命令行参数传入，**不通过进程外的方式注入**。
2. **就绪信号**：在能接活之前明确表态 —— stdio runner 发 `{"type":"ready", ...}` 帧（`parseFrame` 校验 `v`），其他 runner 用"进程存活/端口可达"。控制侧只认这个信号，不做 sleep 猜测。
3. **帧协议**：stdio runner 的每一行都是 JSON，且必须带 `v`（当前 `PROTOCOL_VERSION = 1`，定义在 `src/main/agents/bridge-protocol.ts`）。版本不匹配时控制侧**只报一次**并记入 deadletter，而不是半读半个帧。
4. **终态**：每轮任务必须发一个终态帧（`done` 或 `error`）。`error` 要带 `code`（`invalid_config` / `no_credentials` / `provider_error` / `timeout` / `internal`），控制侧据此分流（配置错进 deadletter、凭据缺失提示去配置、"provider 错"可重试）。
5. **流式边界**：思考文本与正文之间发 `reasoning_end`，工具调用前也发一次 —— 让前端直接按边界切块，而不是用正则猜（历史包袱见 `ReasoningTimeline.splitIntoSteps`，现在只在旧会话上兜底）。
6. **中断**：收到 `SIGTERM` 要尽快退出；控制侧 3 秒后补 `SIGKILL`（`DesktopAgentBridge.killBridge`）。孤儿进程由下次启动的 `reapOrphanBridges()` 清理。
7. **不写共享状态**：runner 只在工作区目录和 `~/.hermes`（继承自 hermes 的约定）里写东西；控制侧的状态在 SQLite/JSON，两者不交叉。

## 接一个新的 runner（三层，抄最浅的一层）

1. **已有 executor 换个命令**：往 `src/main/agents/cli-executor.ts` 的 `CLI_AGENTS` 加一条 `{ cmd, args }` —— 适合"某个 CLI 已经有 headless 模式"。
2. **自己实现 `AgentExecutor`**：实现 `execute/isAvailable/spec`（`prewarm`/`shutdown` 可选），在 `agents/manager.ts` 的探测里注册。stdio 协议按上面第 3-5 条实现，`spec().protocol.version` 复用 `PROTOCOL_VERSION`。
3. **只提供 runner 进程**：不改代码，让进程遵守上面的 stdio 契约；控制侧通过 `CliAgentExecutor` 起它。要出现在自检里就补一条 `CLI_AGENTS` 或 `spec()`。

## 自检

设置 → 活动 → 🩺 环境自检 → 运行自检：`agent runners` 一行会列出每个 runner 的启动命令、就绪信号、协议版本、工作目录，以及 CLI runner 是否在 PATH 上（`which` 探测）。
