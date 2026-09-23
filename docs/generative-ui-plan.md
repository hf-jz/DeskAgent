# 文本指令 → 具象化窗口：根本重设计方案

2026-08-02 · 基于联网调研（A2UI/AG-UI/MCP-UI/OpenAI Apps SDK/Vercel AI SDK/SDUI 六项核实）

## 0. 之前方案为什么"初级"

之前的实现（包括市面上多数 agent 客户端）走的是**指令 → 文字回复 + 侧面板表单**的老路：窗口是程序员预写死的，LLM 只填参数。这满足不了"指令具象化窗口"的核心诉求——**窗口本身的结构由指令决定，且指令可以事后实时改界面**。

两条看似可行的死路先排除：

- **LLM 生成代码再编译**：每次改界面都要重新编译重启，正是需求里明确要消灭的路径。且生成代码不可信，渲染端执行 LLM 代码是安全事故温床。
- **iframe 整体下发（MCP-UI 路线）**：调研确认 MCP-UI 仍是早期草案、无成熟包，iframe 整体加载不原生支持增量更新，"指令实时改界面"做不了。

## 1. 核心结论（调研验证后）

**唯一正解：LLM 不生成代码，生成"界面描述"(declarative schema)；渲染器预编译，schema 即数据，数据可流式打补丁。**

这就是 server-driven UI（Airbnb Ghost / Shopify SDUI 用了十年），LLM 时代的变化只是 schema 的作者从后端工程师变成 agent。调研核实的生态现状：

| 候选 | 状态 | 判断 |
|---|---|---|
| Google A2UI | v0.9.1 public preview,v1.0 RC 中 | **采用其思想**：声明式 JSON 组件树 + 客户端组件 catalog，明确支持 incremental update（JSONL 流式）,"safe like data" |
| AG-UI (CopilotKit) | 活跃，TS SDK 成熟 | **可选传输层**：事件流协议（STATE_DELTA 等），自己协议够简单就不用 |
| MCP-UI | 早期草案，无 npm 包 | 不采用（iframe 无增量） |
| OpenAI Apps SDK / Open-JSON-UI | 平台绑定 | 不适用桌面 |
| Vercel AI SDK generative UI | 活跃但绑 Next.js RSC | Electron 纯 SPA 适配成本高，不采用 |
| 开源通用 schema→React 渲染器 | **不存在** | 自建，约 200 行 |

**选型：A2UI 思想的自有 JSON DSL + 自建 React 渲染器 + SSE/IPC 传输。** 不引外部协议库——deskapp 已有 hermes 引擎管道，传输是自己家的事。

## 2. 三层架构

```
用户文本指令 ──► Hermes Agent (引擎)
                     │  输出不是文字,是 schema (JSON)
                     ▼
              ┌─ Schema Bus (Electron main) ─┐
              │  全量 snapshot + JSON Patch   │  RFC 6902
              └──┬───────────────┬───────────┘
            IPC  │               │ IPC
                 ▼               ▼
        ┌─────────────┐  ┌─────────────┐
        │ 任务窗口 A   │  │ 任务窗口 B   │  ...每个运行中任务一个 BrowserWindow
        │ SchemaRenderer│  │ SchemaRenderer│
        └─────────────┘  └─────────────┘
                 │               │
                 ▼               ▼
              自绘 Dock 条 (always-on-top 窗口, 失焦缩入)
```

### 层 1：组件目录（Component Catalog，预编译，~20 个组件）
词汇表，一次写死，永不因指令改变而重编译：

- 输入： `text-input` `textarea` `cron-picker` `datetime-picker` `select` `multi-select` `toggle` `slider`
- 展示： `markdown` `kv-list` `log-view` `status-badge` `result-feed`（搜索结果卡片流）
- 动作： `button`（绑定 action id)、`icon-button`
- 布局： `stack` `row` `card` `divider` `tabs`

每个组件是带 deskapp 设计 token 的 React 组件（直接复用现有 theme.css 体系）。

### 层 2：Schema DSL（窗口即数据）
```jsonc
{
  "window": "task-config",
  "title": "每日定时搜索",
  "taskId": "cron_9f2c",
  "state": "configuring",        // configuring | running | stopped | error
  "children": [
    { "type": "cron-picker",   "id": "schedule", "label": "定时",      "value": "0 9 * * *" },
    { "type": "text-input",    "id": "topic",    "label": "搜索主题",   "value": "AI 智能体行业动态" },
    { "type": "textarea",      "id": "detail",   "label": "详细内容",   "value": "..." },
    { "type": "multi-select",  "id": "channels", "label": "结果展示",
      "options": ["window", "wechat", "feishu"], "value": ["window"] },
    { "type": "result-feed",   "id": "feed",     "visibleWhen": "state == 'running'" },
    { "type": "row", "children": [
      { "type": "button", "id": "run",  "label": "运行", "action": "task.run",  "primary": true },
      { "type": "button", "id": "stop", "label": "停止", "action": "task.stop", "visibleWhen": "state == 'running'" }
    ]}
  ]
}
```
规则：组件 type 必须在 catalog 内；schema 是**唯一真相源**——对话和 GUI 都收敛到它，永不出现"界面和聊天不一致"。

### 层 3：实时同步 = JSON Patch (RFC 6902)
- 用户在 GUI 改 → 渲染器回传 patch → main 更新 schema 存根 → 同步给 agent 上下文。
- 用户发文本"改成每天 9 点半" → agent 输出 `[{"op":"replace","path":"/children/0/value","value":"30 9 * * *"}]` → main 应用 → IPC 广播 → 窗口当场变。**无重编译、无重启**，这就是需求里最难的那部分的全部答案。
- agent 侧改造点：hermes 自定义工具 `ui.render(schema)` / `ui.patch(patch)`，注册进引擎（deskapp 已有 tools/registry 机制）；prompt 里放 catalog 词汇表和 DSL 规范（<1k token）。

### 任务生命周期
点"运行" → `task.run` action → main 调 hermes cron 工具注册定时任务 → schema.state 变 `running` → 窗口失焦自动缩成 64px 贴边图标，进入 Dock 条。结果产出时 `ui.patch` 追加到 `result-feed`。点 Dock 图标 → 窗口展开回原尺寸。

### Dock（调研结论：自绘是唯一可行路径）
macOS 原生 Dock 一 app 一图标，与"每任务一图标"根本矛盾，且 Electron 不暴露 NSDockTile。方案：一个 `alwaysOnTop + frameless + transparent` BrowserWindow 做 Dock 条（uTools/Rubick 同款做法，~200 行），任务窗口 minimize 时动画缩入。macOS 全屏 Space 下隐藏 Dock 条避免错位。

### 预警推送
任务进程 stderr/exit code/cron miss 监听 → 预警事件 → 双通道：窗口状态变 `error` + Dock 图标角标，同时远程 webhook。调研结论：**企业微信/飞书群机器人 webhook 零成本**（一条 POST)；推个人微信用 **PushPlus**(token + 一行 GET)。通道配置本身就是 schema 里的 `channels` 字段，agent 也能用指令改。

## 3. 落到 deskapp 的实施路径

1. **SchemaRenderer**（新，~200 行）:`src/renderer/src/schema/` 下 catalog 注册表 + 递归渲染 + patch 应用（`fast-json-patch`，一个依赖）。
2. **Schema Bus**（新，main 进程，~150 行）:schema 存根 + patch 应用 + IPC 广播 + 窗口生命周期。
3. **hermes 工具**（改）：注册 `ui.render`/`ui.patch` 两个自定义工具；引擎 system prompt 加 DSL 规范。
4. **Dock 窗口**（新，~200 行）：复用现有 pet 窗口的 frameless/transparent 模式。
5. **推送通道**（新，~100 行）:webhook POST + PushPlus GET，配置走现有 secrets 存储。
6. 定时任务执行：复用 hermes cron（已验证可用），不另起调度器。

总增量约 700 行 + 1 个依赖。不重写现有 bubble/workspace/settings。

## 4. 验证标准（做完才算数）
- 文本"每天 9 点搜 AI 新闻，结果发飞书" → 窗口出现且字段已填好 → 点运行 → cron 注册成功
- 窗口开着说"改 9 点半、加发微信" → 界面无闪烁更新，cron 配置同步改
- 任务失败 → Dock 角标红 + 飞书群收到预警
- 全程无重新编译、无窗口重启
