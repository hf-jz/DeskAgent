# Scheduler 元素调研清单（AutoCLI + 参考项目）

调研时间: 2026-08-14
方法: AutoCLI 公开源（stackoverflow/hackernews）+ wenxibuddy 参考项目 + 产品常识
说明: AutoCLI 公开源仅 stackoverflow/hackernews 等四类（其余需浏览器扩展），项目管理元素
网上信息有限，本清单以参考项目为主、AutoCLI 结果为补充。

## AutoCLI 检索结果（原始）
- stackoverflow "project management features tasks kanban": Kanban 拖拽排序、Azure DevOps Board 重排权限
- hackernews "project management tool features": Tablane（个人项目管理）、产品开发 setup、
  程序员友好型 PM 工具讨论（痛点: 过度复杂/仪式感过重）

## 元素清单（按参考项目 + 检索结论汇总）
已用 ✅ 标注当前 deskapp Scheduler 实现状态。

### 日程/会议（wenxibuddy ScheduleManagementPage）
- ✅ 月/周/日三视图（月网格、周列、日时间轴）
- ✅ 优先级筛选（高/中/低）
- ✅ 新建/编辑/删除（LiquidModal 表单: 标题/日期/时间/会议室/优先级/参与人/状态）
- ✅ 事件卡（房间/参与人/状态徽标、进行中 Live 角标）
- ✅ Toast 反馈
- ⏳ 拖动改期（周/日视图拖事件条换时间）—— 未做，UI 上可后补
- ⏳ 重复日程（每天/每周 recurrence）—— 未做，需 DB 加 recurrence 字段
- ⏳ 冲突检测（同时间段重叠提示）—— 未做

### 项目/任务（wenxibuddy 任务管理 + ProjectOverview）
- ✅ 项目列表卡片（健康度、阶段、完成进度条、截止）
- ✅ 项目详情弹窗: KPI 行（总/完成/进行中/阻塞）
- ✅ 任务看板: 阶段分组（需求评审/产品设计/开发实现/测试验证）+ 折叠
- ✅ 全部/我负责的/我参与的 tab + 状态筛选
- ✅ 任务 CRUD（标题/阶段/状态/优先级/起止/负责人/描述）
- ✅ 项目时间线（周/双周/月缩放、平移、今天、今天竖线）
- ✅ 弹窗内 +任务 / +日程 / +项目
- ⏳ 任务依赖/前置阻塞标记 —— 未做（PM 工具常见元素，检索确认是高频需求）
- ⏳ 里程碑节点（wenxibuddy 有"里程碑 14/16"KPI）—— 项目表无里程碑字段
- ⏳ 拖拽改状态（看板泳道拖拽）—— 未做
- ⏳ AI 自动分解（用户一句话 → 生成任务分解）—— 未做（agent 可经 deskapp_scheduler 工具建任务）

### Agent 集成
- ✅ deskapp_scheduler 工具（Hermes 侧注册）: create/update/delete event/task/project + today
- ✅ 今日摘要注入 agent prompt（今日日程/项目/任务/定时任务）
- ✅ today 动作自动打开 Scheduler 窗口
- ⏳ 定时生成"今日简报"推送到 inbox —— 未做（可在 P4 用 cron 实现）

## 下一步建议（按价值排序）
1. 任务依赖 + 里程碑（项目/任务表加字段，时间线/看板展示）—— 覆盖检索确认的高频需求
2. 拖拽改期（周/日视图）—— 日程页体验补全
3. 重复日程 recurrence —— 先确认是否有真实使用场景再动 DB
4. 每日简报 cron（早晨 8:00 自动生成今日安排推送）—— 与"早上打开软件问安排"闭环
