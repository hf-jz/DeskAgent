# DeskApp 对话式 Onboarding 设计方案

版本: v1.0 · 2026-07-21
状态: 已确认，进入实施

---

## 1. 前提纠正：用户缺的不是"安装智能体"

DeskApp 内嵌 hermes-agent（resources/ 111MB + uv），智能体本体随包自带。
首次启动真正缺的只有一样东西：**LLM API key**。

"提醒用户安装智能体"是伪命题——把安装压力转嫁给用户是设计错觉。
真正的设计问题是：**如何让宠物在第一分钟就活过来**。

外部 agent（Claude Code / Hermes / OpenClaw）是进阶增强，不是门槛，
不应出现在第一屏。

## 2. 现状诊断

当前实现（setup-wizard.ts + SetupWizard.tsx，371 行）是"安装程序式"向导：

- 520×560 独立居中窗口
- 4 个步骤（provider → credentials → test → done），步骤点指示器
- 首次启动即弹出，阻断宠物出现

问题：用户下载的是桌面宠物，第一眼看到的却是配置表单——**情绪断裂**。
宠物产品的情绪曲线应该是：见到它 → 产生好感 → 才愿意为它做事（配 key）。
顺序反了，流失就高。

类比：领养宠物是先见面，不是先签文件。

## 3. 设计方案：气泡即向导

一切系统提示都"从宠物嘴里说出来"，不弹任何独立窗口。

### L0 第一眼（0-3 秒）：宠物先活，配置后置

宠物出现、呼吸动画，头顶气泡自动展开：

> "嗨，我是你的桌面伙伴。"

情感连接先于一切配置。

### L1 一句话检测汇报（3-5 秒）

气泡切换：

> "让我看看这台电脑……"

后台并行执行：needsSetup() + agents/manager 外部 agent 扫描，有进度感。
三种结果分支：

| 检测结果 | 气泡话术 | 后续 |
|---|---|---|
| 已有 key 配置 | "我准备好了，跟我说句话试试。" | 直接可用，零打扰 |
| 无 key 但发现外部 agent | "我发现了 Claude Code，可以借它工作；也可以给我配一个自己的大脑。→ 配置" | 一键进 L2 |
| 什么都没有（新机器最常见） | "我自带了智能核心，只差一把钥匙就能思考。→ 现在配置（30 秒）" | 一键进 L2 |

### L2 配置动作（30 秒）：气泡内联展开，不是新窗口

点配置后气泡放大，一次只问一件事：

1. provider 图标化四选一（OpenAI / Anthropic / DeepSeek / Google + 自定义折叠）
2. 粘贴 key（password 输入，模型 / baseURL 全默认，"高级"折叠）
3. 粘贴后**自动** testConnection，转圈 → "连上了！问我点什么吧。"

全程无步骤条、无"上一步/下一步"。
30 秒内完成"它活了"的反馈闭环。

### L3 跳过与后路

气泡角落常驻小字"稍后再说"。

- 跳过后宠物照常生活（动画/拖拽/右键全可用）
- 对话时回复："我还没有大脑，点这里配置"
- settings-store 记 onboardingDismissedAt，隔数天轻提醒一次，绝不每次启动都烦
- Settings 页保留完整 provider 配置作为后路，与气泡共用同一存储

### L4 外部 agent 渐进发现

不在首启罗列 agent 清单（选择焦虑——用户根本不知道区别）。
后台 detect，发现时在合适时机由宠物提一次：

> "注意到你装了 Hermes CLI，重活可以交给它。→ 了解"

安装新 agent 的引导只在该 agent 能解锁具体场景价值时出现
（场景化，而非清单化）。

## 4. 反面清单（不要做的）

- 不要全屏多页 wizard（当前实现就是）
- 不要首启让用户"选择安装哪个 agent"
- 不要能自动检测的还问用户
- 不要阻断式系统弹窗——宠物产品里弹窗 = 出戏

## 5. 落地改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | src/main/setup-wizard.ts | 保留 needsSetup/saveConfig/testConnection/readExistingConfig/PROVIDERS；createSetupWindow 不再自启，降为 IPC 数据层 |
| 2 | src/main/ipc-handlers.ts | onboarding 状态聚合 IPC（needsSetup + existing + providers + agent 扫描结果） |
| 3 | src/main/settings-store.ts | 新增 onboardingDismissedAt 字段 |
| 4 | src/main/index.ts | 首启不再 createSetupWindow，直接进宠物；首启后自动展开气泡 |
| 5 | src/preload/index.ts | 暴露 onboarding API（getState/save/test/skip/dismiss） |
| 6 | src/renderer/src/bubble/BubbleApp.tsx | onboarding 状态机：greeting → detecting → result → inline-config → verifying → alive |
| 7 | （复用） | setup:test / setup:save IPC 原样复用；Settings provider 配置为后路 |

## 6. 状态机定义

```
greeting      宠物第一句话（首启自动弹气泡）
   │ 1.5s
   ▼
detecting     "让我看看这台电脑……"（并行 needsSetup + agent 扫描）
   │
   ├─→ ready           已有 key：直接可用
   ├─→ found-external  无 key 有外部 agent：提示可借用 + 配置入口
   └─→ none            什么都没有：配置入口
         │ 点"现在配置"
         ▼
inline-config 气泡内联表单（provider → key，自动 test）
         │ test 通过
         ▼
verifying     转圈中
         │
         ▼
alive         "连上了！问我点什么吧。" → 正常聊天态

任意结果态可点"稍后再说" → dismissed（记录时间戳，进入轻提醒周期）
```

## 7. 设计原则

**第一次打开的目标不是"完成配置"，而是"30 秒内让用户听到宠物的第一句话"——
配置是达成这个目标的副产品。**
