// CLI-based agent execution for openclaw / claude-code / codex.
// ponytail: the subcommand conventions — claude -p / codex exec are the
// documented headless modes; `openclaw run` is a best-effort guess (the CLI
// couldn't be introspected on this machine — node-version gate). Adjust the
// openclaw args if its headless verb differs.
import { spawn } from 'child_process'
import type { TaskStreamCallbacks } from './types'
import type { RunnerSpec } from './executor'

export const CLI_AGENTS: Record<string, { cmd: string; args: (prompt: string) => string[] }> = {
  'claude-code': { cmd: 'claude', args: (p) => ['-p', p] },
  codex:        { cmd: 'codex',  args: (p) => ['exec', p] },
  openclaw:     { cmd: 'openclaw', args: (p) => ['run', p] },
}

export class CliAgentExecutor {
  constructor(private agentId: string) {}

  /** Runner contract (see docs/runner-contract.md): a CLI agent is a
   *  child-process runner whose "ready" signal is just "the binary exists". */
  spec(): RunnerSpec {
    const c = CLI_AGENTS[this.agentId]
    return {
      id: this.agentId,
      launch: { kind: 'child-process', command: c?.cmd ?? this.agentId, args: c ? c.args('<prompt>') : [] },
      ready: 'process-alive',
      workspace: 'process-cwd',
      debugAttach: false,
    }
  }

  async execute(task: string, cbs: TaskStreamCallbacks): Promise<{ abort: () => void }> {
    const c = CLI_AGENTS[this.agentId]
    if (!c) { cbs.onError(`no CLI executor for agent ${this.agentId}`); return { abort: () => {} } }
    const child = spawn(c.cmd, c.args(task), { env: { ...process.env } })
    let acc = ''
    child.stdout.on('data', (d) => { const s = String(d); acc += s; cbs.onChunk(s) })
    child.stderr.on('data', (d) => { const s = String(d); acc += s; cbs.onChunk(s) })
    child.on('error', (e) => cbs.onError(e.message))
    child.on('close', (code) => { code === 0 ? cbs.onDone() : cbs.onError(`CLI exited ${code}`) })
    return { abort: () => { child.kill('SIGKILL'); cbs.onInterrupted?.(acc) } }
  }
}
