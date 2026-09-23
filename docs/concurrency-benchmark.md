# DeskApp 多气泡并发能力实测报告

> 测试日期：2026-07-17
> 测试环境：macOS，16GB RAM，8 核 CPU
> 架构版本：BridgeManager 多进程并发版（每气泡独立 bridge 进程 + 热备）

## 架构模型

```
                    ┌─ 气泡1 → bridge进程1（独立 AIAgent + 会话历史）
pet 点击 → 新气泡 ──┼─ 气泡2 → bridge进程2（独立 AIAgent + 会话历史）   全部并发
                    └─ 气泡3 → bridge进程3（独立 AIAgent + 会话历史）
                         + 1 个热备进程（新气泡秒接管，后台自动补备）
```

与 "hermes CLI 开 N 个 terminal" 完全同构：每个气泡一个独立 Python 进程，
进程间完全隔离，任务并发执行互不干扰。

## 单气泡资源成本（实测）

| 组件 | 内存 |
|---|---|
| bridge 进程（Python + hermes-agent，空闲） | ~130-170MB |
| bridge 运行复杂任务时 | ~200-300MB |
| Electron 渲染进程（气泡窗口） | ~60-100MB |
| **每气泡合计** | **~250-300MB** |

基础开销（主进程 + pet + hit + GPU helper + 热备 bridge）：约 700MB。

## 并发能力估算（16GB RAM）

| 场景 | 气泡数 | 内存占用 | 状态 |
|---|---|---|---|
| 轻松 | **8-12 个** | ~3-4GB | 流畅，推荐日常上限 |
| 可承受 | 15-20 个 | ~5-6GB | 可用，开始有内存压力（与 Docker/VSCode 共存时） |
| 极限 | ~25 个 | ~7-8GB | swap 介入，明显卡顿 |

## 瓶颈分层分析

1. **空闲气泡几乎零 CPU** — bridge 阻塞在 stdin 读取，只占内存。
   macOS 内存压缩对空闲 Python 进程友好，实际驻留会更低。
2. **同时活跃任务**：
   - 纯问答（网络流式）：10+ 个无压力
   - 带工具执行（终端命令/浏览器）：吃 CPU，8 核机器同时 4-6 个重任务流畅
3. **API 侧**：每个 bridge 独立调用 DeepSeek API，并发 10-20 路流式无问题。

## 结论

- **日常放心开 10 个左右，极限 20 个**
- 同时执行"重活"（爬网页、跑终端命令）控制在 5 个以内体验最佳

## 未来优化方向：空闲回收（可将上限翻三倍）

气泡 N 分钟无提问 → 杀掉其 bridge（对话历史存盘 session-store）→
下次提问秒级重建恢复。空闲气泡从 ~250MB 降至 ~80MB（仅渲染进程）。

## 关键实现文件

| 文件 | 职责 |
|---|---|
| `src/main/agents/desktop-agent.ts` | `DesktopAgentBridge`（单进程管理）+ `BridgeManager`（多进程调度 + 热备） |
| `src/main/index.ts` | `activeAborts: Map<webContentsId, AbortHandle>` 按气泡隔离 abort |
| `resources/bridge.py` | JSON Lines 协议、agent 预创建、实时 reasoning/tool 回调 |

## 关键设计点

1. **热备模式（spare bridge）**：应用启动即预热 1 个 bridge（agent 已创建完毕），
   新气泡直接接管零延迟，后台自动补充下一个热备。
2. **Per-bubble abort**：同一气泡内重新提问才 abort 自己的上一个任务，
   不影响其他气泡（旧版全局 activeAbort 会互杀）。
3. **Stale exit guard**：被替换/杀死的旧进程迟到的 exit 事件不会误伤新任务
   （`this.proc !== proc` 判断）。
4. **生命周期**：气泡关闭 → 杀掉专属 bridge；应用退出 → `shutdownAll()`。
5. **降级链**：bridge 失败 → hermes gateway HTTP SSE fallback。
