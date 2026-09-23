import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

let STATS_DIR = ''

// ── Types ──
export interface ToolRecord { name: string; startTime: number; duration: number; success: boolean }
export interface ErrorPattern { pattern: string; count: number; lastSeen: number; suggestion: string }
export interface AttemptRecord { task: string; attempt: number; approach: string; success: boolean; timestamp: number }
export interface ContextBullet { id: string; description: string; createdAt: number }
export interface DecisionRecord { editTarget: string; prediction: string; actual: string; verified: boolean }
export interface CapabilityScore { name: string; score: number; maxScore: number; updatedAt: number }
export interface AgentStatsData {
  toolHistory: ToolRecord[]
  errorPatterns: ErrorPattern[]
  attemptLog: AttemptRecord[]
  contextLogbook: ContextBullet[]
  decisionLog: DecisionRecord[]
  capabilityScores: CapabilityScore[]
  totalTasks: number; successTasks: number
}

let data: AgentStatsData = {
  toolHistory: [], errorPatterns: [], attemptLog: [],
  contextLogbook: [], decisionLog: [], capabilityScores: [],
  totalTasks: 0, successTasks: 0
}

export function initAgentStats(appDataPath: string): void {
  STATS_DIR = join(appDataPath, 'stats')
  mkdirSync(STATS_DIR, { recursive: true })
  loadFromDisk()
}

function loadFromDisk(): void {
  const f = join(STATS_DIR, 'agent-stats.json')
  if (!existsSync(f)) return
  try { data = { ...data, ...JSON.parse(readFileSync(f, 'utf-8')) } } catch {}
}

function saveToDisk(): void {
  writeFileSync(join(STATS_DIR, 'agent-stats.json'), JSON.stringify(data, null, 2))
}

export function getAgentStats(): AgentStatsData { return data }

// ── Trackers ──
export function trackToolCall(name: string, success: boolean, duration: number): void {
  data.toolHistory.unshift({ name, startTime: Date.now() - duration, duration, success })
  if (data.toolHistory.length > 200) data.toolHistory.length = 200
  data.totalTasks++
  if (success) data.successTasks++
  saveToDisk()
}

export function trackError(pattern: string, suggestion: string): void {
  const existing = data.errorPatterns.find(e => e.pattern === pattern)
  if (existing) { existing.count++; existing.lastSeen = Date.now() }
  else data.errorPatterns.push({ pattern, count: 1, lastSeen: Date.now(), suggestion })
  if (data.errorPatterns.length > 50) data.errorPatterns = data.errorPatterns.slice(-50)
  saveToDisk()
}

export function trackAttempt(task: string, attempt: number, approach: string, success: boolean): void {
  data.attemptLog.push({ task, attempt, approach, success, timestamp: Date.now() })
  if (data.attemptLog.length > 100) data.attemptLog = data.attemptLog.slice(-100)
  saveToDisk()
}

export function trackContextBullet(id: string, description: string): void {
  const existing = data.contextLogbook.find(b => b.id === id)
  if (existing) { existing.description = description; existing.createdAt = Date.now() }
  else data.contextLogbook.push({ id, description, createdAt: Date.now() })
  if (data.contextLogbook.length > 100) data.contextLogbook = data.contextLogbook.slice(-100)
  saveToDisk()
}

export function trackDecision(editTarget: string, prediction: string, actual: string, verified: boolean): void {
  data.decisionLog.unshift({ editTarget, prediction, actual, verified })
  if (data.decisionLog.length > 50) data.decisionLog.length = 50
  saveToDisk()
}

export function updateCapabilityScore(name: string, score: number, maxScore: number): void {
  const existing = data.capabilityScores.find(c => c.name === name)
  if (existing) { existing.score = score; existing.maxScore = maxScore; existing.updatedAt = Date.now() }
  else data.capabilityScores.push({ name, score, maxScore, updatedAt: Date.now() })
  saveToDisk()
}
