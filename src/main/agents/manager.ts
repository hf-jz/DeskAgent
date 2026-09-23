import { AgentRegistry } from './registry'
import type { AgentId, DetectionResult, InstalledAgent, TaskRequest, TaskStreamCallbacks } from './types'

export interface AgentManagerState {
  agents: InstalledAgent[]
  activeAgentId: AgentId | null
  lastScanTime: number
}

export class AgentManager {
  private registry: AgentRegistry
  private state: AgentManagerState = {
    agents: [],
    activeAgentId: null,
    lastScanTime: 0
  }

  // Callbacks for state changes
  private onStateChange?: (state: AgentManagerState) => void

  constructor(onStateChange?: (state: AgentManagerState) => void) {
    this.registry = new AgentRegistry()
    this.onStateChange = onStateChange
    this.loadSavedState()
  }

  getState(): AgentManagerState {
    return { ...this.state }
  }

  getRegistry(): AgentRegistry {
    return this.registry
  }

  /** Scan all agents and update state */
  async scanAll(): Promise<AgentManagerState> {
    const results = await this.registry.scanAll()
    const agents: InstalledAgent[] = []

    for (const result of results) {
      if (result.agent) {
        agents.push(result.agent)
      }
    }

    // Auto-select logic
    const installedAgents = agents.filter(a => a.status !== 'not-installed')
    if (installedAgents.length === 1 && !this.state.activeAgentId) {
      this.state.activeAgentId = installedAgents[0].id
    } else if (installedAgents.length === 0) {
      this.state.activeAgentId = null
    }

    this.state.agents = agents
    this.state.lastScanTime = Date.now()
    this.saveState()
    this.notifyStateChange()

    return this.state
  }

  /** Set the active (default) agent */
  setActiveAgent(agentId: AgentId | null): void {
    this.state.activeAgentId = agentId
    this.saveState()
    this.notifyStateChange()
  }

  /** Get the active agent, or null if none selected */
  getActiveAgent(): InstalledAgent | null {
    if (!this.state.activeAgentId) return null
    return this.state.agents.find(a => a.id === this.state.activeAgentId) || null
  }

  /** Install an agent */
  async installAgent(agentId: AgentId): Promise<{ success: boolean; error?: string }> {
    const detector = this.registry.getDetector(agentId)
    if (!detector) {
      return { success: false, error: `Unknown agent: ${agentId}` }
    }
    return detector.install()
  }

  /** Start an agent */
  async startAgent(agentId: AgentId): Promise<{ success: boolean; error?: string }> {
    const detector = this.registry.getDetector(agentId)
    if (!detector) return { success: false, error: `Unknown agent: ${agentId}` }
    return detector.start()
  }

  /** Stop an agent */
  async stopAgent(agentId: AgentId): Promise<{ success: boolean; error?: string }> {
    const detector = this.registry.getDetector(agentId)
    if (!detector) return { success: false, error: `Unknown agent: ${agentId}` }
    return detector.stop()
  }

  /** Execute a task using the active agent */
  async executeTask(request: TaskRequest, callbacks: TaskStreamCallbacks): Promise<void> {
    // Use the hermes module's executeTask which handles gateway start + API
    const { executeTask: hermesExecute } = await import('./detect-hermes')
    await hermesExecute(request.task, callbacks)
  }

  /** Persist active agent selection */
  private loadSavedState(): void {
    try {
      const fs = require('fs')
      const { app } = require('electron')
      const statePath = require('path').join(app.getPath('userData'), 'deskapp-state.json')
      if (fs.existsSync(statePath)) {
        const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
        if (saved.activeAgentId) {
          this.state.activeAgentId = saved.activeAgentId
        }
      }
    } catch {
      // Ignore — use defaults
    }
  }

  private saveState(): void {
    try {
      const fs = require('fs')
      const { app } = require('electron')
      const statePath = require('path').join(app.getPath('userData'), 'deskapp-state.json')
      fs.mkdirSync(require('path').dirname(statePath), { recursive: true })
      fs.writeFileSync(statePath, JSON.stringify({
        activeAgentId: this.state.activeAgentId
      }, null, 2), 'utf-8')
    } catch {
      // Ignore — non-critical
    }
  }

  private notifyStateChange(): void {
    this.onStateChange?.(this.state)
  }
}
