import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as http from 'http'
import type { AgentDetector, DetectionResult } from './types'

const OPENCLAW_PORT = 18789

const KNOWN_PATHS = [
  join(homedir(), '.openclaw', 'venv', 'bin', 'openclaw'),
  join(homedir(), 'venv', 'bin', 'openclaw'),
  join(homedir(), '.local', 'bin', 'openclaw'),
  '/opt/homebrew/bin/openclaw',
  '/usr/local/bin/openclaw'
]

function execCommand(command: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout) => {
      resolve({ stdout: (stdout || '').trim(), code: error ? 1 : 0 })
    })
  })
}

async function findOpenClawBinary(): Promise<string | null> {
  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p
  }
  if (process.platform !== 'win32') {
    const { whichViaLoginShell } = require('./detect-cli')
    const viaShell = await whichViaLoginShell('openclaw')
    if (viaShell && existsSync(viaShell)) return viaShell
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const { stdout, code } = await execCommand(whichCmd, ['openclaw'])
  if (code === 0 && stdout && existsSync(stdout)) return stdout
  return null
}

async function getOpenClawVersion(binaryPath: string): Promise<string> {
  const { stdout } = await execCommand(binaryPath, ['--version'])
  if (stdout) {
    const match = stdout.match(/[\d.]+/)
    if (match) return match[0]
  }
  return 'unknown'
}

async function isOpenClawRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: OPENCLAW_PORT, path: '/health', method: 'HEAD', timeout: 1500 },
      (res) => { resolve(res.statusCode === 200); res.resume() }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

export class OpenClawDetector implements AgentDetector {
  readonly agentId = 'openclaw' as const
  readonly agentName = 'OpenClaw'

  async detect(): Promise<DetectionResult> {
    const binaryPath = await findOpenClawBinary()
    if (!binaryPath) {
      return {
        found: false,
        agent: {
          id: 'openclaw',
          name: 'OpenClaw',
          publisher: 'OpenClaw',
          version: '',
          installPath: '',
          status: 'not-installed',
          port: null,
          description: 'Open-source AI coding agent with tool use',
          tags: ['coding', 'agents', 'CLI']
        }
      }
    }

    const version = await getOpenClawVersion(binaryPath)
    const running = await isOpenClawRunning()

    return {
      found: true,
      agent: {
        id: 'openclaw',
        name: 'OpenClaw',
        publisher: 'OpenClaw',
        version,
        installPath: binaryPath,
        status: running ? 'running' : 'installed',
        port: running ? OPENCLAW_PORT : null,
        description: 'Open-source AI coding agent with tool use',
        tags: ['coding', 'agents', 'CLI']
      }
    }
  }

  getInstallCommand(): string {
    return 'pip install openclaw'
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    // GUI app 无 pip（PATH 受限）——登录 shell 执行
    const { installViaLoginShell } = require('./detect-cli')
    return installViaLoginShell('pip install openclaw 2>/dev/null || python3 -m pip install openclaw')
  }

  async checkRunning(): Promise<boolean> {
    return isOpenClawRunning()
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Start not yet implemented for OpenClaw' }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Stop not yet implemented for OpenClaw' }
  }
}
