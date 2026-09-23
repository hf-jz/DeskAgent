# Security Policy

DeskApp 在**你的机器上**执行 agent 产生的 shell 命令、读写 `~/.hermes` 下的模型配置与凭据，
并通过 `resources/bridge.py` 与子进程通信，所以安全问题按"本地执行边界"对待。

## 报告漏洞

请**不要**开公开 issue。用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
（仓库 Security → Report a vulnerability），或直接联系仓库维护者。

请附：影响版本（`package.json` 的 version 或 commit）、复现步骤、影响面（能读到什么 / 能执行什么）。
我们会在确认后于修复版本中致谢（除非你要求匿名）。

## 设计上的安全边界（不是漏洞）

- 审批门控：agent 的工具调用默认要经过用户确认（`resources/bridge.py` 的 approval 回调 + 气泡里的审批卡）；
  定时任务以 `auto_approve` 运行（无人值守），其每次自动放行会写审计日志（`userData/audit/*.jsonl`）。
- 凭据：模型 API key 存 `~/.hermes/.env` 或 `~/.hermes/config.yaml`（写入时 chmod 600），
  不随仓库分发；`config.yaml` 的所有写入路径都经过 `setup-wizard.ts:validateSlot` 校验（拒绝换行注入等非法值）。
- 渲染层：窗口默认 `contextIsolation: true` + CSP；仅宠物自定义/图片转 3D 窗口需要放宽 `webSecurity`。

## 支持范围

仅当前 `main` 分支的最新提交；旧版本只做确认，不保证回补。
