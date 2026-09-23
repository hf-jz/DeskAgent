# DESIGN.md — DeskApp 设计系统

来源: impeccable `document`（从现有代码提炼）+ taste-skill 校准。桌面宠物 AI Agent，Operate 模式（工具型产品 UI），暗色玻璃质感为主世界。

## 世界 (Visual World)
- **模式**: Operate。用户在任务中，界面退到任务后面；品牌活在精确的细节里。
- **质感**: 深色玻璃（bubble/pet 窗口透明背景 + 玻璃拟态是本质属性，不是装饰）。
- **个性载体**: pet（Bobo/Mochi 等 SVG 角色）是唯一允许" playful "的表面；bubble/workspace/settings 保持克制。
- **参考**: wenxibuddy 液态毛玻璃设计系统（纯黑 void + emerald 霓虹强调色 + 40px blur + 顶缘高光）。

## Tokens（src/renderer/src/assets/theme.css 为唯一权威）
- 表面: --bg-page / --bg-panel / --bg-card / --bg-hover / --bg-elev / --bg-glass(-heavy) / --bg-input
- 墨色: --ink / --ink-secondary / --ink-muted / --ink-faint
- 线: --line / --line-strong
- 强调: --accent (#34d399 emerald 暗 / #059669 亮) / --accent-soft / --accent-text；辅助 --accent-2 (#38bdf8 sky，仅 bubble 渐变身份用)
- 语义: --ok/--warn/--danger/--info 各配 -soft 与 -text 变体
- 阴影: --shadow-sm/md/lg（带偏移的软阴影，无彩色光晕）
- 圆角: --radius-sm 4 / md 8 / lg 16 / xl 22（一套尺度，不混用）
- 焦点: --focus-ring（双层环，所有可交互元素统一）
- 双主题: [data-theme="dark"|"light"]，组件只许引用 var(--*)，禁止硬编码色值

## 规则（craft floor）
1. 颜色只走 token。新组件硬编码 hex/rgba = 返工（pet SVG 角色固有配色、macOS 红绿灯除外）。
2. 交互动效 150–250ms，仅 transform/opacity；prefers-reduced-motion 下全部坍缩为瞬时。
3. 交互组件必须有 default/hover/focus/active/disabled 状态；焦点用 --focus-ring。
4. 动效只传达状态（反馈/加载/揭示），禁止装饰性动效与页面加载编排。
5. 加载用骨架屏不用居中 spinner；空状态要教会界面，不写 "nothing here"。
6. 数字/计时/KPI 用 tabular-nums。
7. 一套圆角尺度；卡片 8–14px，小控件可 pill；幽灵卡（1px border + 大阴影叠加）禁止，elevation 二选一。
8. 强调色仅用于主操作/当前选中/状态指示，不用于装饰。

## 已知债（后续批次）
- 全部 .tsx 已两轮 token 化（801 处）。残留: 阴影 alpha rgba(0,0,0,x)、零星单次语义色（pet SVG 角色配色与 macOS 红绿灯属豁免）。
- impeccable detector 未随 skill 捆绑（需 repo CLI build），检测目前靠人工 + 本文件规则。
