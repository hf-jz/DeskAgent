import { execFile, ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as http from 'http'
import type { AgentDetector, DetectionResult, AgentProtocolHandler, TaskRequest, TaskStreamCallbacks } from './types'
import type { AgentExecutor, AbortHandle, RunnerSpec } from './executor'
import { classifyTask, WORKER_MODEL, WORKER_PROVIDER } from './task-router'

const HERMES_PORT = 8642

const KNOWN_PATHS = [
  join(homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
  join(homedir(), 'venv', 'bin', 'hermes'),
  join(homedir(), '.local', 'bin', 'hermes'),
  join(homedir(), '.npm-global', 'bin', 'hermes'),
  '/opt/homebrew/bin/hermes',
  '/usr/local/bin/hermes'
]

function execCommand(command: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout) => {
      resolve({ stdout: (stdout || '').trim(), code: error ? 1 : 0 })
    })
  })
}

async function findHermesBinary(): Promise<string | null> {
  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p
  }
  if (process.platform !== 'win32') {
    // GUI app PATH 限制: 登录 shell 真实 PATH（nvm/volta 等动态安装）
    const { whichViaLoginShell } = require('./detect-cli')
    const viaShell = await whichViaLoginShell('hermes')
    if (viaShell && existsSync(viaShell)) return viaShell
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const { stdout, code } = await execCommand(whichCmd, ['hermes'])
  if (code === 0 && stdout && existsSync(stdout)) return stdout
  return null
}

async function getHermesVersion(binaryPath: string): Promise<string> {
  const { stdout } = await execCommand(binaryPath, ['--version'])
  const match = stdout.match(/[\d.]+/)
  return match ? match[0] : 'unknown'
}

async function isHermesRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: HERMES_PORT, path: '/health', method: 'GET', timeout: 1500 },
      (res) => { resolve(res.statusCode === 200); res.resume() }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

let gatewayProcess: ChildProcess | null = null

async function startHermesGateway(): Promise<{ success: boolean; error?: string }> {
  const binary = await findHermesBinary()
  if (!binary) return { success: false, error: 'Hermes binary not found' }

  // Determine HERMES_HOME
  let hermesHome: string
  if (binary.includes('.hermes')) {
    hermesHome = binary.replace(/\/venv\/bin\/hermes$/, '').replace(/\/bin\/hermes$/, '')
  } else if (binary.includes('hermes-agent')) {
    hermesHome = binary.replace(/\/venv\/bin\/hermes$/, '')
  } else {
    hermesHome = join(homedir(), '.hermes')
  }

  console.log('[DeskApp] Starting hermes gateway:', binary, 'HOME:', hermesHome)

  return new Promise((resolve) => {
    try {
      gatewayProcess = execFile(
        binary,
        ['gateway', 'run'],
        {
          cwd: hermesHome,
          env: {
            ...process.env,
            HERMES_HOME: hermesHome,
            PATH: `${binary.replace(/\/hermes$/, '')}:${process.env.PATH || ''}`
          }
        }
      )

      // Wait for gateway to be ready
      let attempts = 0
      const check = setInterval(async () => {
        attempts++
        const running = await isHermesRunning()
        if (running) {
          clearInterval(check)
          console.log('[DeskApp] Hermes gateway ready')
          resolve({ success: true })
        } else if (attempts > 30) {
          clearInterval(check)
          resolve({ success: false, error: 'Gateway failed to start within 15s' })
        }
      }, 500)

      gatewayProcess.on('error', (err) => {
        clearInterval(check)
        resolve({ success: false, error: err.message })
      })

      gatewayProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          clearInterval(check)
          resolve({ success: false, error: `Gateway exited with code ${code}` })
        }
      })
    } catch (e) {
      resolve({ success: false, error: String(e) })
    }
  })
}

// ── HTTP API task execution ──
let _apiToken: string | null = null
let _apiTokenFetchedAt = 0
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000  // re-read token every 5 minutes

function getApiToken(): string {
  // Re-read from disk if cache is stale or empty
  const now = Date.now()
  if (_apiToken !== null && (now - _apiTokenFetchedAt) < TOKEN_CACHE_TTL_MS) return _apiToken
  try {
    const configPath = join(homedir(), '.hermes', 'config.yaml')
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8')
      const match = content.match(/token:\s*(\S+)/)
      if (match) {
        _apiToken = match[1]
        _apiTokenFetchedAt = now
      }
    }
  } catch { /* */ }
  return _apiToken || ''
}

/** Invalidate the cached token — call when gateway stops or config changes. */
function invalidateApiToken(): void {
  _apiToken = null
  _apiTokenFetchedAt = 0
}

function executeViaApi(task: string, callbacks: TaskStreamCallbacks): { abort: () => void } {
  const controller = new AbortController()
  let done = false

  const body = JSON.stringify({
    model: 'hermes-agent',
    messages: [{ role: 'user', content: task }],
    stream: true
  })

  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: HERMES_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${getApiToken()}`
      },
      timeout: 300000
    },
    (res) => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              if (!done) { done = true; callbacks.onDone() }
              return
            }
            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta
              const content = delta?.content
              const reasoning = delta?.reasoning_content
              if (content) callbacks.onChunk(content)
              if (reasoning) callbacks.onReasoning?.(reasoning)
              // Tool calls in delta
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const fn = tc?.function
                  if (fn) {
                    if (fn.name) callbacks.onToolCall?.(fn.name, fn.arguments || '{}')
                  }
                }
              }
            } catch { /* skip */ }
          }
        }
      })

      res.on('end', () => { if (!done) { done = true; callbacks.onDone() } })
      res.on('error', (err) => { if (!done) { done = true; callbacks.onError(err.message) } })
    }
  )

  req.on('error', (err) => {
    if (!done) { done = true; callbacks.onError(`Connection failed: ${err.message}`) }
  })

  req.write(body)
  req.end()

  return { abort: () => { req.destroy(); controller.abort() } }
}

// ── CLI fallback ──
function executeViaCli(
  binaryPath: string,
  task: string,
  callbacks: TaskStreamCallbacks,
  modelOverride?: { model: string; provider: string }
): { abort: () => void } {
  let done = false
  const args = ['chat', '-q', task]
  if (modelOverride) args.push('-m', modelOverride.model, '--provider', modelOverride.provider)
  const child = execFile(binaryPath, args, {
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024
  }, (error, stdout, stderr) => {
    if (done) return
    done = true
    if (error && !stdout) {
      callbacks.onError(error.message)
    } else {
      if (stdout) callbacks.onChunk(stdout)
      if (stderr) callbacks.onChunk(stderr)
      callbacks.onDone()
    }
  })

  child.on('error', (err) => {
    if (!done) { done = true; callbacks.onError(err.message) }
  })

  return { abort: () => { child.kill(); done = true } }
}

// ── Main execute function ──
export async function executeTask(
  task: string,
  callbacks: TaskStreamCallbacks
): Promise<{ abort: () => void }> {
  console.log('[DeskApp] executeTask:', task.substring(0, 50))

  // Tier routing: simple tasks run directly on the cheap worker model and
  // never touch the frontier planner (kimi-k3). Complex tasks go through
  // the planner, which delegates execution to worker subagents.
  const tier = classifyTask(task)
  if (tier === 'simple') {
    const binary = await findHermesBinary()
    if (binary) {
      console.log(`[DeskApp] Task tier: simple → ${WORKER_MODEL} (planner bypassed)`)
      return executeViaCli(binary, task, callbacks, { model: WORKER_MODEL, provider: WORKER_PROVIDER })
    }
    console.log('[DeskApp] Task tier: simple but no CLI binary, falling through to planner')
  } else {
    console.log('[DeskApp] Task tier: complex → planner (kimi-k3) with worker delegation')
  }

  // Check if gateway is already running
  const running = await isHermesRunning()
  if (!running) {
    console.log('[DeskApp] Gateway not running, starting...')
    callbacks.onChunk('Starting Hermes agent...\n')
    const startResult = await startHermesGateway()
    if (!startResult.success) {
      // Fall back to CLI
      console.log('[DeskApp] Gateway start failed, falling back to CLI')
      const binary = await findHermesBinary()
      if (binary) {
        return executeViaCli(binary, task, callbacks)
      }
      callbacks.onError(startResult.error || 'Failed to start agent')
      return { abort: () => {} }
    }
  }

  // Execute via HTTP API
  console.log('[DeskApp] Sending task via API')
  return executeViaApi(task, callbacks)
}

// ── Detector class (for AgentRegistry) ──
export class HermesDetector implements AgentDetector {
  readonly agentId = 'hermes' as const
  readonly agentName = 'Hermes Agent'

  async detect(): Promise<DetectionResult> {
    // 内置 embedded bundle（deskapp 主路径引擎：resources/hermes-agent + uv）——
    // 打包时随 app 分发，新机器无需外部安装。存在即视为已就绪。
    try {
      const { app } = require('electron')
      const bundleDir = app.isPackaged
        ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'hermes-agent')
        : join(app.getAppPath(), 'resources', 'hermes-agent')
      if (existsSync(join(bundleDir, 'run_agent.py'))) {
        return {
          found: true,
          agent: {
            id: 'hermes', name: 'Hermes Agent', publisher: 'Nous Research',
            version: 'embedded', installPath: bundleDir, status: 'running', port: null,
            description: 'Autonomous AI agent with tool-calling, skills, memory（DeskApp 内置引擎）',
            tags: ['coding', 'agents', 'CLI']
          }
        }
      }
    } catch { /* resources dir unavailable — fall through to PATH detection */ }

    const binaryPath = await findHermesBinary()
    if (!binaryPath) {
      return {
        found: false,
        agent: {
          id: 'hermes', name: 'Hermes Agent', publisher: 'Nous Research',
          version: '', installPath: '', status: 'not-installed', port: null,
          description: 'Autonomous AI agent with tool-calling, skills, memory',
          tags: ['coding', 'agents', 'CLI']
        }
      }
    }

    const version = await getHermesVersion(binaryPath)
    const running = await isHermesRunning()

    return {
      found: true,
      agent: {
        id: 'hermes', name: 'Hermes Agent', publisher: 'Nous Research',
        version, installPath: binaryPath,
        status: running ? 'running' : 'installed',
        port: running ? HERMES_PORT : null,
        description: 'Autonomous AI agent with tool-calling, skills, memory',
        tags: ['coding', 'agents', 'CLI']
      }
    }
  }

  getInstallCommand(): string {
    return process.platform === 'win32'
      ? 'irm https://hermes-agent.nousresearch.com/install.ps1 | iex'
      : 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      const cmd = process.platform === 'win32'
        ? 'powershell -Command "irm https://hermes-agent.nousresearch.com/install.ps1 | iex"'
        : 'bash -c "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"'
      await execCommand(process.platform === 'win32' ? 'powershell' : 'bash',
        process.platform === 'win32' ? ['-Command', 'irm https://hermes-agent.nousresearch.com/install.ps1 | iex'] : ['-c', 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async checkRunning(): Promise<boolean> { return isHermesRunning() }

  async start(): Promise<{ success: boolean; error?: string }> {
    return startHermesGateway()
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      if (gatewayProcess) { gatewayProcess.kill(); gatewayProcess = null }
      invalidateApiToken()
      await execCommand('pkill', ['-f', 'hermes gateway'])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }
}

// ── AgentExecutor wrapper ──

export class HermesGatewayExecutor implements AgentExecutor {
  readonly name = 'hermes-gateway'

  async execute(task: string, cbs: TaskStreamCallbacks): Promise<AbortHandle> {
    return executeTask(task, cbs)
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (await isHermesRunning()) return true
      // Check if binary exists (can be started)
      return (await findHermesBinary()) !== null
    } catch {
      return false
    }
  }

  async prewarm(): Promise<void> {
    console.log('[DeskApp] Pre-warming hermes gateway...')
    if (await isHermesRunning()) {
      console.log('[DeskApp] Hermes gateway already running')
      return
    }
    const result = await startHermesGateway()
    if (result.success) {
      console.log('[DeskApp] Hermes gateway started')
    } else {
      console.log('[DeskApp] Hermes gateway unavailable:', result.error)
    }
  }

  shutdown(): void {
    if (gatewayProcess) {
      gatewayProcess.kill()
      gatewayProcess = null
    }
  }

  spec(): RunnerSpec {
    return {
      id: 'hermes-gateway',
      launch: { kind: 'daemon', command: 'hermes (gateway daemon)' },
      ready: 'process-alive',
      workspace: 'process-cwd',
      debugAttach: false,
    }
  }
}

export const hermesGatewayExecutor = new HermesGatewayExecutor()
