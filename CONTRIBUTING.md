# 贡献指南

感谢你对 DeskApp 的关注！以下指引帮助你在本仓库高效协作。

## 提交 Issue

在 [Issues](https://github.com/nous-research/deskapp/issues) 页面新建问题前：

1. **搜索已有 issue**，确认你的问题或建议未被提过
2. Bug 报告请包含：macOS/Windows/Linux 版本、Electron 版本 (`npm ls electron`)、复现步骤、预期 vs 实际行为
3. 功能请求请描述：使用场景、期望的交互方式、为什么现有能力无法满足

## 提交 PR

1. **Fork 仓库**，从 `main` 分支切出你的改动分支
2. **保持 PR 聚焦**：一个 PR 只做一件事（修复/特性/文档）
3. **提交前自测**：

```bash
npm install
npm run build          # 确保编译无错误
npm run start          # 启动验证功能正常
```

4. **commit message** 使用中文简要描述改动，如 `修复气泡关闭后 session 丢失`、`新增文件浏览器 Grid 视图`
5. 推送分支后在 GitHub 发起 PR，描述改动内容与测试情况

## 本地开发

```bash
# 安装依赖（Node.js ≥ 24, Python 3.11+）
npm install

# 完整构建（主进程 + preload + 渲染进程）
npm run build

# 构建 + 启动应用
npm run start

# 开发模式（Vite HMR 热更渲染进程 + Electron）
npm run dev

# 快速重启（自动清理旧进程 + 重建 + 启动，仅 macOS）
./restart.sh
```

构建产物说明：

| 命令 | 产出 |
|---|---|
| `npm run build:main` | `dist/main/` — Electron 主进程 (TypeScript → JS) |
| `npm run build:preload` | `dist/preload/` — 预加载脚本 (contextBridge) |
| `npm run build:renderer` | `dist/renderer/` — React 前端 (Vite) |
| `npm run build` | 以上三者串联执行 |
| `npm run dev` | 主进程 + preload 编译后，Vite dev server + Electron 并行启动 |

## 项目结构速览

```
src/
├── main/          Electron 主进程 (IPC / 窗口管理 / Agent 桥接)
├── preload/       contextBridge (安全暴露 IPC 给渲染进程)
└── renderer/      React UI (宠物动画 / 气泡 / 设置 / 文件浏览器)
resources/
├── bridge.py      Python Bridge (JSON Lines IPC, AIAgent 生命周期)
├── bootstrap.py   首次 venv 引导
└── hermes-agent/  嵌入的 hermes-agent 引擎
docs/              设计文档、性能测试、痛点分析
config/            TypeScript + Vite 编译配置
```

提交前请确保改动符合现有代码风格（Electron 主进程用 Class-based 模式，渲染进程用 React Hooks + functional 组件）。
