
# 办公创作（Office Content Studio）：气泡一句话 → 设计界面 → 成品

2026-08-13 · 需求：给 deskapp 增加办公内容创作能力（PPT / 画册 / 产品手册 / 宣传动画 / 展示主页），复用 personal-homepage-skill 全套技能元素，结合 wenxibuddy 窗口元素。

## 0. 核心链路

---
```
气泡说目的("根据 ~/Desktop/产品资料 制作展示PPT")
  → agent(hermes) 调 deskapp_genui create kind=presentation
  → gen-ui.ts 校验+保存 spec → 卡片窗口弹出
  → ContentStudio 设计界面(素材文件夹/标题/风格/结构/输出)
  → 用户点「生成成品」→ genui:run-spec → cron 任务执行
  → agent 加载 personal-homepage-skill/docx/hyperframes 技能
  → 遍历素材文件夹 → 生成成品(HTML/docx/MP4) → 保存到输出目录
  → 结果 JSON {file, ...} 回灌 props.history → 界面显示「打开成品」
```
---

完全复用现有 GenUI 管线：spec 即数据、`{{prop}}` 模板填充、run→cron→onResult 回灌、卡片/工作区双端渲染。**未引入任何新依赖、新窗口类型、新协议**。

## 1. 新增 5 个 kind

| kind | 图标 | 成品 | 生成技能 | 默认输出 |
|---|---|---|---|---|
| presentation | 📽️ | 16:9 HTML 演示文稿 (deck.html) | personal-homepage-skill (Presentation Mode) | ~/Desktop/成品/演示文稿 |
| brochure | 📕 | HTML 产品画册/宣传册 (index.html) | personal-homepage-skill (Homepage Mode) | ~/Desktop/成品/产品画册 |
| manual | 📘 | Word 产品手册 (.docx) | docx (python-docx) | ~/Desktop/成品/产品手册 |
| video | 🎬 | 宣传动画 (promo.mp4) | hyperframes (npx hyperframes) | ~/Desktop/成品/宣传动画 |
| homepage | 🏠 | 展示主页/作品集 (index.html) | personal-homepage-skill (Homepage Mode) | ~/Desktop/成品/展示主页 |

props 契约（全部可选、设计界面可改）：

| prop | 含义 | 默认 |
|---|---|---|
| source | 素材文件夹路径（可拖入） | 空 |
| title | 主题标题 | spec.title |
| style | 风格预设（STYLE_PRESETS.md 18 选） | 按 kind 各配默认 |
| extra | 结构要求（章节/卖点，可选） | 空 |
| output | 成品保存路径 | ~/Desktop/成品/<kind> |
| history | 历史结果（agent 回灌，只读） | [] |

## 2. ContentStudio 设计界面（新增组件）

wenxibuddy 液态毛玻璃风格：圆角 20 玻璃面板 + 顶缘高光 + 内阴影 + emerald 强调色，全部走内联样式（与 WindowCard 一致，不引设计系统依赖）。

| 区域 | 内容 |
|---|---|
| 头部 | macOS 红绿灯（关闭=删窗口停功能、最小化=叠回 dock）+ kind 图标 + 标题 + 运行状态点（就绪/生成中/已完成/失败） |
| 提示行 | 每 kind 一句功能说明（hint） |
| 表单 | 素材文件夹（带拖入高亮，webkitGetAsEntry 取路径）、主题标题、风格预设 18 个 chip（多选一、带 emoji）、结构要求 textarea、输出路径 |
| 成品条 | 从 history 末条正则提取 `"file":"..."`，显示路径 +「打开成品」按钮（genui:open-path → shell.openPath） |
| 底部 | 主按钮「生成成品」→ save props + runSpec；运行中变橙色「停止生成」；右侧「→」跳工作区详情 |

每 kind 内置 `prompt({{source}},{{title}},{{style}},{{extra}},{{output}})` 模板，明文告诉 agent：先 skill_view 加载对应技能 → 遍历素材文件夹提炼内容（不编造数据）→ 按 STYLE_PRESETS 预设 + CJK 字体 → 生成单文件成品到输出目录 → 浏览器打开验证 → 回 `{"file":绝对路径,...}`。

## 3. 改动文件清单

| 文件 | 改动 |
|---|---|
| src/shared/gen-ui-types.ts | COMPONENT_KINDS +5；新增 CONTENT_KINDS 集合 |
| src/shared/ipc-channels.ts | +genui:open-path 通道 |
| src/main/ipc-handlers.ts | +open-path handler（shell.openPath，防注入：仅 string + trim） |
| src/preload/index.ts | genui.openPath API |
| src/renderer/src/workspace/components/ContentStudio.tsx | **新组件**：设计界面 + STUDIO_KINDS 元数据 + STYLE_PRESETS 18 项 |
| src/renderer/src/workspace/components/index.ts | 5 kind → ContentStudio |
| src/renderer/src/card/CardApp.tsx | CONTENT_KINDS 卡片：渲染 ContentStudio 并放大窗口 460×640，普通 kind 保持原逻辑 |
| src/renderer/src/workspace/SpecCard.tsx | 组件额外传 spec+status（ContentStudio 需读写 props、显示运行态） |
| resources/bridge.py | GENUI_KINDS +5；工具描述增加办公创作段落（5 kind 的 props 规范与生成指引） |
| src/renderer/src/workspace/templates.ts | TEMPLATE_ICONS +5（presentation/brochure/manual/video/homepage） |

## 4. 关键设计决策

1. **不新增 spec 字段**：输出位置复用 props，prompt 模板复用 cron.prompt 的 `{{prop}}` 填充机制，结果复用 props.history — 主进程 gen-ui.ts / cron.ts 零改动。
2. **设计界面 = 组件而非新窗口类型**：5 个 kind 共享一个 ContentStudio，靠 STUDIO_KINDS 元数据区分（图标/提示/prompt 模板/默认输出），新增内容类型只加一条元数据。
3. **打开成品走 IPC 而非 agent**：shell.openPath 由主进程执行，渲染端不接触 Node API（contextIsolation 下本就拿不到）。
4. **风格预设硬编码 18 项**：取自 personal-homepage-skill STYLE_PRESETS.md 的章节名，与技能文档保持同源；不动态读技能文件，避免渲染端 I/O。
5. **信任边界**：open-path 仅接受非空 string（主进程校验）；props 长度截断沿用 validateSpec 既有 2000 字符限制。

## 5. 待办（本期未做）

| 项 | 说明 |
|---|---|
| templates.ts 5 条快捷模板 | 任务模版区加「制作PPT/产品画册/产品手册/宣传动画/展示主页」入口（图标已备好） |
| 技能安装 | 将 personal-homepage-skill 复制到 ~/.hermes/skills/（HERMES_HOME 指向该目录，agent 才能 skill_view 加载） |
| 构建验证 | npm run test + npm run build（须先 export PATH 到 node v24.16.0） |
| prompt 防编造 | 依赖 agent 遵循模板；若实测编造数据，在模板里加「内容必须来自素材文件，找不到就明确写缺失」强约束 |

## 6. 验证路径

1. 构建通过后重启 deskapp。
2. 气泡输入「根据 ~/Desktop/产品资料 制作一份展示PPT」。
3. 断言：卡片弹出设计界面（460×640）→ 自动预填 source/style → 点「生成成品」→ 状态转生成中 → 完成后成品条出现 → 点「打开成品」浏览器打开 deck.html。
4. 回归：普通 kind（feed/clock 等）卡片仍走 WindowCard 原逻辑，大小伸缩不变。


