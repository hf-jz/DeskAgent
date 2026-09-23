# DeskApp 电脑软件操控功能方案（Desktop Control）

状态: 方案稿 · 2026-08-21 · 待评审后实施

## 1. 现状盘点（已有能力，零新增引擎）

| 已有能力 | 位置 | 说明 |
|---------|------|------|
| computer_use 工具（cua-driver） | resources/hermes-agent/tools/computer_use/ | macOS Accessibility 驱动任意应用：capture(SOM/vision/ax) / click / drag / scroll / type / key / focus_app / list_apps。**已内置，deskapp 的 agent 可直接调用** |
| deskapp 工具注册体系 | resources/bridge.py | deskapp_wake / deskapp_genui / deskapp_scheduler 已注册 Hermes registry，可照此模式加 deskapp_screen |
| Apple 应用级 skill | ~/.hermes/skills/apple/ | imessage / apple-notes / apple-reminders / findmy / macos-computer-use——已有 5 个应用操控 skill 模板 |
| UI 载体 | 气泡 / 宠物 / Dock / 工作窗口 | 气泡已能显示 agent 推理流式输出，可承载操作进度与截图回显 |
| 文件系统 | vfs / file-explorer | 已有虚拟文件系统 + 文件浏览器 |

## 2. 可借鉴来源（AutoCLI 检索 2026-08-21）

| 项目 | 要点 | 借鉴点 |
|------|------|--------|
| agent-desktop (HN 99 分) | Native desktop automation CLI for AI agents | 把系统操作暴露为**结构化 CLI 工具**给 agent 调用；工具 schema 设计 |
| OculOS | 桌面控制 via MCP server | MCP 兼容层（后续可选）；agent 持"桌面控制权"的会话模型 |
| legacy-use | computer-use 给遗留软件加 REST API | **应用级操作模板固化**（把"点这个按钮"固化成可复用 API） |
| macos-computer-use (本地 skill) | 后台驱动 macOS 不抢光标/焦点 | 交互规范：capture-first、element index 点击、操作后验证 |

## 3. 架构设计（四层）

```
┌─ UI 层 ──────────────────────────────────────────────┐
│ 气泡「屏幕操作」入口 / 操作日志卡 / 截图回显           │
├─ Agent 层 ────────────────────────────────────────────┤
│ deskapp_screen 工具 (bridge.py → Hermes registry)     │
│   ├─ screen:list-apps / open / activate / quit        │  ← L1 原生桥(无权限)
│   ├─ screen:capture / click / type / key / scroll     │  ← L2 cua-driver(需辅助功能权限)
│   └─ app-skill:<name> 应用模板                         │  ← L3 固化操作序列
├─ 执行层 ──────────────────────────────────────────────┤
│ L1: Electron shell / osascript / open (系统能力)      │
│ L2: cua-driver (hermes-agent 内置)                    │
│ L3: AppleScript / 快捷键 / CLI 组合 skill             │
└─ 权限层 ──────────────────────────────────────────────┤
   macOS 辅助功能 + 屏幕录制权限检测与引导（Settings 新增）
```

### L1 原生桥（无 accessibility 权限也能用）
- `app:list` — 运行中应用（bundleId/PID/窗口数）
- `app:open <name|path>` — 启动应用（`open -a`）
- `app:activate <name>` — 聚焦应用（`osascript activate`）
- `app:quit <name>` — 退出应用（`osascript quit`）
主进程 IPC 实现（同 scheduler 模式），renderer 无 UI，仅供 agent 工具用。

### L2 屏幕驱动（核心，复用 cua-driver）
注册 `deskapp_screen` 工具（bridge.py，照 deskapp_scheduler 模式）：
- 包装 hermes-agent 的 computer_use 动作：capture / click(element|coord) / type / key / scroll / drag / focus_app
- agent 说「打开 Safari 里的项目页面并截图」→ 一次工具调用链完成
- 权限未授予时返回明确错误 + 引导文案（Settings → 辅助功能）

### L3 应用 skill 目录（借鉴 legacy-use 的模板固化）
首批 6-8 个常用应用操作模板（skill 形式，agent 按需加载）：
- Finder：打开路径 / 新建文件夹 / 快速查找
- 邮件：新邮件 / 发信给某人（配合已有的 imessage/notes/reminders）
- 浏览器：新标签 / 打开 URL / 前进后退（browser 已有，此为原生 Safari 版本）
- 终端：开窗口 / 跑命令（截图验证输出）
- IDE（VS Code）：打开项目 / 全局搜索 / 运行任务
- 系统：截图 / 音量 / 勿扰 / 深色模式切换
每个模板 = computer_use 动作序列 + 验证点（capture 确认）。

### L4 反馈闭环
- agent 操作后自动 capture 回显到气泡（用户看到"它点到了什么"）
- 气泡内操作日志卡（步骤列表 + 每步截图缩略）
- 多步编排：「打开邮件 → 写新邮件给 Brandon → 附上 report.pdf → 发送」，agent 分步执行并逐步确认

## 4. 实施阶段

| 阶段 | 内容 | 验收 |
|------|------|------|
| P1 | L1 原生桥 IPC + `deskapp_screen` 工具注册 + 权限检测引导（Settings 新增「屏幕操控」tab） | 气泡说「打开备忘录」→ app 启动；说「截个图」→ 截图回显 |
| P2 | L3 应用 skill 首批 6-8 个 + 气泡操作日志卡 | 「帮我打开邮件写一封给 Brandon」多步操作可见可验证 |
| P3 | 截图回显 + 复杂编排 + 操作确认/取消交互 | 危险操作（发信/删除）在气泡内确认后执行 |
| P4 | OculOS 式 MCP 兼容层（可选） | 外部 MCP 客户端可复用同一驱动 |

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| macOS 辅助功能/屏幕录制权限 | 检测 + 一键跳系统设置引导（P1 必做） |
| cua-driver 在 deepseek 模型下可靠性 | SOM element index 优先于坐标；操作后强制 capture 验证 |
| 误操作（发信/删除等不可逆动作） | 危险动作前置气泡确认（P3）；skill 模板内置安全边界 |
| 后台驱动 vs 用户抢操作 | 沿用 macos-computer-use 规范：不抢光标/焦点/不切 Space（cua-driver 天生支持） |

## 6. 不做的事（边界）

- 不重造 computer_use 引擎（cua-driver 已内置）
- 不做跨平台（L2 仅 macOS，Windows/Linux 走 L1 原生桥 + 各自 shell）
- 不接 MCP 直到 P4（当前 deskapp 工具注册体系已够用）
