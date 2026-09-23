# img2threejs × DeskApp 全链路集成方案

> 目标：气泡窗口命令 → img2threejs 功能窗口化 → forge 流水线落地 → 最终 HTML 成品。
> 参考：微信文章《做工业3D模型的看过来, 3D 资产的下一个形态原来是TypeScript》+ ~/web/img2threejs。

## 1. img2threejs 核心机制（调研结论）

- **本质**：Claude Code skill（`~/.claude/skills/img2threejs`），把参考图重建为**代码型** Three.js 模型（TS 工厂函数），不是 .glb。TS 源码可读/可改/可版本管理 → "3D 资产 = 代码"。
- **引擎**：`forge/` 零依赖 Python（标准库，手写 PNG struct+zlib）。
- **状态机**（9 道质量门禁的骨架）：`forge/state.py init --reference <img> --profile generic` 初始化 → `forge/next.py --state <state.json>` 报告下一步（LOCAL_STATE 行：status/step/pass/loop 计数/nextCommand/pending 步骤）→ `forge/state.py mark <step> --evidence <file>` 标记完成。
- **流水线**：stage1_intake → stage2_spec → stage3_build（blockout→structure→form→material→lighting→interaction→optimization passes，`orchestrate_passes.py`）→ stage4_review → stage5_rig。
- **质量门禁**：每 pass 用参考图 vs 渲染图对比判定 pass/refine（LLM 视觉步骤）；spec 不合格不允许生成代码。
- **产物**：spec.json、pass 渲染图、`generate_threejs_factory.py` 生成的 TS 工厂 + viewer HTML。

## 2. 全链路设计（四环）

### 环 1：气泡窗口命令
用户对宠物说"把这张图做成 3D"。气泡 agent 上下文注入 img2threejs 能力说明（agents 模板）：
- agent 收到 3D/建模/img2threejs 类请求时：运行 `python3 <img2threejs>/forge/state.py init --reference <图> --profile generic` 初始化项目状态 → 打开 deskapp 的 img2threejs 控制台窗口 → 向用户汇报流水线当前步骤与下一步。
- 无视觉模型时的降级：agent 驱动确定性步骤（intake 校验、spec 撰写、mark 前进），pass 判定由用户/控制台按钮确认。

### 环 2：功能窗口化（本方案核心交付）
新增独立窗口页 `page='img2threejs'`（参考 create-window 工厂），**流水线控制台**：
- 状态面板：status/currentStep/currentPass/loop(次数/上限)/stopReason/nextCommand/pending 步骤列表——把 forge 的 LOCAL_STATE 结构化呈现。
- 控制按钮：① 初始化（选参考图 + 项目名 → state.py init）② 标记完成并下一步（mark + next）③ 刷新状态。
- 产物区：扫描项目目录 `.img2threejs/` + `artifacts/`，列出 spec.json / pass 渲染图 / 生成的 .ts / viewer .html。
- 预览区：成品 HTML 内嵌 iframe 预览 + "在浏览器打开"。

### 环 3：功能应用落地
- main 进程新模块 `img2threejs.ts`：spawn `python3 forge/*.py`、解析 LOCAL_STATE（纯函数，可单测）、项目状态文件管理、产物发现。
- IPC 通道：`img2threejs:open` / `img2threejs:init` / `img2threejs:next` / `img2threejs:mark` / `img2threejs:status` / `img2threejs:artifacts`。
- 项目工作目录：`~/3d-projects/<name>/`（用户可改），隔离每次建模。

### 环 4：HTML 成品
- stage3_build 的 `generate_threejs_factory.py` 输出 TS 工厂；viewer HTML 由 forge 配套模板生成。
- 控制台产物区发现 .html → 内嵌预览 + 浏览器打开（`shell.openPath`）。
- 验证路径：完整流水线需 LLM 视觉 pass（deepseek 无视觉 → 由用户/控制台确认），确定性阶段（intake/blockout/spec 生成）可自动跑通。

## 3. 实施清单

| 文件 | 内容 |
|---|---|
| `src/main/img2threejs.ts` | spawn 封装 + LOCAL_STATE 解析（可测）+ 产物发现 + 窗口 |
| `src/shared/ipc-channels.ts` | 6 个新通道 + 类型 |
| `src/main/ipc-handlers.ts` | handler 注册 |
| `src/preload/index.ts` | API |
| `src/renderer/src/img2threejs/Img2ThreeJsApp.tsx` | 控制台 UI |
| `src/renderer/src/main.tsx` | 路由 |
| `src/main/agents/context.ts` 或 templates | 气泡 agent 能力提示 |
| `tests/img2threejs.test.ts` | LOCAL_STATE 解析单测 |
| `tests/e2e/img2threejs.spec.ts` | 窗口→init→status 链路 |

## 4. 验证方案
1. 单测：LOCAL_STATE/STATE 解析器（构造输出 → 断言结构化字段）。
2. 真实链路：`forge/state.py init` + `next.py` 用一张测试图跑通（确定性阶段），确认 LOCAL_STATE 输出与解析一致。
3. e2e：打开 img2threejs 窗口 → init → 状态面板显示当前步骤。
4. build + 全量 test。

## 5. 风险与边界
- deepseek 无视觉：pass 判定依赖用户/控制台确认（窗口按钮"标记完成"即人肉 pass）。
- forge 完整流水线耗时/依赖：MVP 验证到状态机 + 窗口 + 产物发现；HTML 成品验证用确定性产物。
- 窗口复用 create-window 工厂模式，避免新造窗口基建。
