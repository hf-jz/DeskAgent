import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentDetector, DetectionResult } from './types'

const KNOWN_PATHS = [
  // npm global install
  join(homedir(), '.npm', 'node_modules', '.bin', 'claude'),
  join(homedir(), '.npm-global', 'bin', 'claude'),
  join(homedir(), '.bun', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  // 官方原生安装器（claude-code install）
  join(homedir(), '.local', 'bin', 'claude'),
  // npx fallback
  join(homedir(), 'node_modules', '.bin', 'claude')
]

function execCommand(command: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout) => {
      resolve({ stdout: (stdout || '').trim(), code: error ? 1 : 0 })
    })
  })
}

async function findClaudeBinary(): Promise<string | null> {
  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p
  }
  if (process.platform !== 'win32') {
    // GUI app PATH 限制: 走登录 shell 的真实 PATH（覆盖 nvm/volta/fnm 等动态安装）
    const { whichViaLoginShell } = require('./detect-cli')
    const viaShell = await whichViaLoginShell('claude')
    if (viaShell && existsSync(viaShell)) return viaShell
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const { stdout, code } = await execCommand(whichCmd, ['claude'])
  if (code === 0 && stdout && existsSync(stdout)) return stdout
  return null
}

async function getClaudeVersion(): Promise<string> {
  // Claude Code: try retrieving version via npm list
  try {
    const { stdout } = await execCommand('npm', ['list', '-g', '@anthropic-ai/claude-code', '--depth=0'])
    const match = stdout.match(/@anthropic-ai\/claude-code@([\d.]+)/)
    if (match) return match[1]
  } catch { /* fall through */ }

  // Try running claude --version
  const binary = await findClaudeBinary()
  if (binary) {
    const { stdout } = await execCommand(binary, ['--version'])
    if (stdout) {
      const match = stdout.match(/[\d.]+/)
      if (match) return match[0]
    }
  }

  return 'unknown'
}

export class ClaudeCodeDetector implements AgentDetector {
  readonly agentId = 'claude-code' as const
  readonly agentName = 'Claude Code'

  async detect(): Promise<DetectionResult> {
    const binaryPath = await findClaudeBinary()

    return {
      found: !!binaryPath,
      agent: {
        id: 'claude-code',
        name: 'Claude Code',
        publisher: 'Anthropic',
        version: binaryPath ? await getClaudeVersion() : '',
        installPath: binaryPath || '',
        status: binaryPath ? 'installed' : 'not-installed',
        port: null, // Claude Code is CLI-only, no HTTP API
        description: 'Anthropic\'s official CLI coding agent',
        tags: ['coding', 'agents', 'CLI', 'anthropic']
      }
    }
  }

  getInstallCommand(): string {
    return 'npm install -g @anthropic-ai/claude-code'
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    // GUI app 无 npm（PATH 受限）——登录 shell 执行
    const { installViaLoginShell } = require('./detect-cli')
    return installViaLoginShell('npm install -g @anthropic-ai/claude-code')
  }

  async checkRunning(): Promise<boolean> {
    // Claude Code is CLI-only, no persistent server
    return false
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Claude Code is CLI-only, no server to start' }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Claude Code is CLI-only, no server to stop' }
  }
}
