import type { TaskStreamCallbacks } from './types'

/** Handle to abort a running task */
export interface AbortHandle {
  abort: () => void
}

/** Unified agent executor interface */
export interface AgentExecutor {
  readonly name: string
  /** Execute a task, returns handle for abort + streams results via callbacks */
  execute(task: string, cbs: TaskStreamCallbacks): Promise<AbortHandle>
  /** Check if this executor is ready to accept tasks */
  isAvailable(): Promise<boolean>
  /** Pre-warm the executor (call on app startup) */
  prewarm?(): Promise<void>
  /** Clean shutdown */
  shutdown?(): void
  /** How this executor runs a task — the runner contract in machine-readable
   *  form (see docs/runner-contract.md). Optional so third-party executors can
   *  appear in the app before they describe themselves. */
  spec?(): RunnerSpec
}

/**
 * Description of HOW an executor runs a task. Borrowed from google/ax's runner
 * contract (docs/ax/01-borrow-list.md B1): the control side never hardcodes how
 * a runner works — it reads the contract. DeskApp uses it for diagnostics and
 * for deciding what it may do to a live runner (attach, reap, restart).
 */
export interface RunnerSpec {
  /** stable id used in logs, IPC and the doctor report */
  id: string
  /** how the runner process is started */
  launch: {
    kind: 'in-process' | 'child-process' | 'daemon'
    command: string
    args?: string[]
  }
  /** how the app knows the runner can accept work */
  ready: 'stdio-frame' | 'http-probe' | 'process-alive'
  /** wire protocol + version it implements (must match bridge-protocol.ts) */
  protocol?: { lang: 'jsonl'; version: number }
  /** what the runner uses as its working directory */
  workspace: 'workspace-dir' | 'bridge-cwd' | 'process-cwd'
  /** whether raw stdio can be attached for debugging (ax: spec.debug) */
  debugAttach: boolean
}

/**
 * CompositeExecutor: tries primary executor first,
 * silently falls back to secondary on failure.
 * Pre-warms both on startup.
 */
export class CompositeExecutor implements AgentExecutor {
  readonly name = 'composite'

  constructor(
    private primary: AgentExecutor,
    private fallback: AgentExecutor,
  ) {}

  get primaryName(): string { return this.primary.name }
  get fallbackName(): string { return this.fallback.name }

  async execute(task: string, cbs: TaskStreamCallbacks): Promise<AbortHandle> {
    const priAvail = await this.primary.isAvailable()
    if (priAvail) {
      try {
        return await this.primary.execute(task, cbs)
      } catch (err) {
        console.error(`[DeskApp] Primary executor (${this.primary.name}) failed:`, err)
        // Fall through to fallback — reuse same callbacks
      }
    }
    console.log(`[DeskApp] Using fallback executor: ${this.fallback.name}`)
    return this.fallback.execute(task, cbs)
  }

  async isAvailable(): Promise<boolean> {
    return (await this.primary.isAvailable()) || (await this.fallback.isAvailable())
  }

  async prewarm(): Promise<void> {
    await Promise.allSettled([
      this.primary.prewarm?.(),
      this.fallback.prewarm?.(),
    ])
  }

  shutdown(): void {
    this.primary.shutdown?.()
    this.fallback.shutdown?.()
  }
}
