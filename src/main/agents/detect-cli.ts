// CLI-binary agent detection: codex + deepseek-harness (dsh).
// Same contract as the hermes/openclaw detectors — Settings→Agents shows the
// agent once its binary is on PATH.
import { execFile } from 'child_process'
import type { AgentDetector, AgentId, DetectionResult, InstalledAgent } from './types'

/**
 * GUI app PATH 限制修复: Finder/Dock 启动的应用 PATH=/usr/bin:/bin:...，
 * 用户安装的 CLI（claude/codex/npm 全局）都在登录 shell PATH 里但 GUI 拿不到。
 * 用 /bin/zsh -l 执行 which —— 登录 shell 会加载用户 .zprofile/.zshrc 的完整 PATH。
 */
/** 登录 shell 执行安装命令（GUI PATH 无 npm/pip 等用户工具，必须走 zsh -l） */
export async function installViaLoginShell(cmd: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { execFile } = require('child_process')
    return await new Promise((resolve) => {
      execFile('/bin/zsh', ['-lc', cmd], { timeout: 180000 }, (err, _stdout, stderr) => {
        if (!err) resolve({ success: true })
        else resolve({ success: false, error: String(stderr || err).slice(0, 300) })
      })
    })
  } catch (e: any) {
    return { success: false, error: String(e).slice(0, 300) }
  }
}

export async function whichViaLoginShell(bin: string): Promise<string | null> {
  try {
    const { execFile } = require('child_process')
    return await new Promise((resolve) => {
      execFile('/bin/zsh', ['-lc', `which ${bin} 2>/dev/null`], { timeout: 6000 }, (err, stdout) => {
        const out = String(stdout || '').trim()
        resolve(!err && out ? out.split('\n')[0].trim() : null)
      })
    })
  } catch { return null }
}

function execCommand(command: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout) => {
      resolve({ stdout: (stdout || '').trim(), code: error ? 1 : 0 })
    })
  })
}

const META: Record<'codex' | 'dsh', { name: string; publisher: string; desc: string; tags: string[]; port: number | null; pkg: string }> = {
  codex: { name: 'Codex', publisher: 'OpenAI', desc: 'OpenAI 命令行编码智能体', tags: ['coding', 'cli'], port: null, pkg: '@openai/codex' },
  dsh:   { name: 'DeepSeek Harness', publisher: 'DeepSeek AI', desc: 'dsh — DeepSeek agent harness（插件化，Cordis 架构）', tags: ['agent', 'cli', 'acp'], port: null, pkg: '@deepseek-ai/dsh' },
}

export class CliBinaryDetector implements AgentDetector {
  readonly agentId: 'codex' | 'dsh'
  readonly agentName: string
  constructor(id: 'codex' | 'dsh') { this.agentId = id; this.agentName = META[id].name }

  async detect(): Promise<DetectionResult> {
    try {
      const bin = this.agentId === 'codex' ? 'codex' : 'dsh'
      // GUI app PATH 限制: 优先登录 shell 真实 PATH（zsh -l），回退基础 which
      let w: { stdout: string; code: number } | null = null
      if (process.platform !== 'win32') {
        const viaShell = await whichViaLoginShell(bin)
        if (viaShell) w = { stdout: viaShell, code: 0 }
      }
      if (!w) {
        const which = process.platform === 'win32' ? 'where' : 'which'
        w = await execCommand(which, [bin])
      }
      const found = w.code === 0 && !!w.stdout
      const v = found ? await execCommand(w.stdout, ['--version']) : { stdout: '' }
      const m = META[this.agentId]
      const agent: InstalledAgent = {
        id: this.agentId as AgentId,
        name: m.name, publisher: m.publisher,
        // not-installed → empty version (UI hides "· v…" when falsy)
        version: found ? (v.stdout.match(/[\d.]+/) || ['unknown'])[0] : '',
        installPath: found ? w.stdout : '',
        status: found ? 'installed' : 'not-installed', port: m.port,
        description: m.desc, tags: m.tags,
      }
      return { found: true, agent }
    } catch (e) {
      return { found: false, agent: null, error: (e as Error).message }
    }
  }

  getInstallCommand(): string {
    return `npm install -g ${META[this.agentId].pkg}`
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    // GUI app 无 npm（PATH 受限）——登录 shell 执行
    return installViaLoginShell(`npm install -g ${META[this.agentId].pkg}`)
  }

  async checkRunning(): Promise<boolean> {
    return false // CLI agents run on demand; no persistent server
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    return { success: true } // started implicitly per task
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }
}
