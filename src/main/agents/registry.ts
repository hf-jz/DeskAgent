import type { AgentDetector, AgentId, DetectionResult } from './types'
import { HermesDetector } from './detect-hermes'
import { OpenClawDetector } from './detect-openclaw'
import { ClaudeCodeDetector } from './detect-claude-code'
import { CliBinaryDetector } from './detect-cli'

/** Registry of all supported agent detectors */
export class AgentRegistry {
  private detectors: Map<AgentId, AgentDetector> = new Map()

  constructor() {
    // Register built-in detectors
    this.register(new HermesDetector())
    this.register(new OpenClawDetector())
    this.register(new ClaudeCodeDetector())
    this.register(new CliBinaryDetector('codex'))
    this.register(new CliBinaryDetector('dsh'))
  }

  register(detector: AgentDetector): void {
    this.detectors.set(detector.agentId, detector)
  }

  getDetector(agentId: AgentId): AgentDetector | undefined {
    return this.detectors.get(agentId)
  }

  getAllDetectors(): AgentDetector[] {
    return Array.from(this.detectors.values())
  }

  getSupportedAgentIds(): AgentId[] {
    return Array.from(this.detectors.keys())
  }

  /** Scan all registered agents and return results */
  async scanAll(): Promise<DetectionResult[]> {
    const results: DetectionResult[] = []
    for (const detector of this.detectors.values()) {
      try {
        const result = await detector.detect()
        results.push(result)
      } catch (err) {
        results.push({
          found: false,
          agent: null,
          error: `Detection failed for ${detector.agentId}: ${err}`
        })
      }
    }
    return results
  }

  /** Scan a specific agent */
  async scan(agentId: AgentId): Promise<DetectionResult> {
    const detector = this.detectors.get(agentId)
    if (!detector) {
      return {
        found: false,
        agent: null,
        error: `Unknown agent: ${agentId}`
      }
    }
    return detector.detect()
  }
}
