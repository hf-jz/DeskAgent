import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { scopedPath, scopedDir } from './account'

export interface PetSettings {
  animStyle: 'strands' | 'rings'
  petStyle?: 'mochi' | 'bobo' | 'strands' | 'rings' | 'custom' // pet appearance; default strands (WebGL wave)
  /** Custom photo pet asset (userData/custom-pet/<id>.png) */
  customPet?: import('../shared/ipc-channels').CustomPetInfo
  /** Custom pet library (all saved photo pets) */
  customPets?: import('../shared/ipc-channels').CustomPetInfo[]
  size: 'S' | 'M' | 'L'
  opacity: number // 30-100
  budgetDaily?: number  // ¥ per day, 0 = unlimited
  budgetMonthly?: number // ¥ per month, 0 = unlimited
  onboardingDismissedAt?: number // timestamp of "稍后再说"; absent = never dismissed
  /** First-run agent-setup wizard shown; timestamp = done */
  agentSetupDoneAt?: number
  /** B11: 习惯工程知情同意 — true 才启动采集；undefined/false = 不观察 */
  habitConsent?: boolean
  /** B10: 暂停观察（持久化，重启后仍是暂停） */
  habitPaused?: boolean
  /** B10: AI 摘要 opt-in（持久化） */
  habitAISummary?: boolean
  /** 懂你指数 LLM 解读缓存（每日最多一次 LLM 调用；score 漂移 >5 也刷新） */
  habitScoreInsight?: string
  habitScoreInsightDate?: string
  habitScoreInsightScore?: number
  /** P0-10: UI theme — light / dark / auto (follows prefers-color-scheme) */
  theme?: 'light' | 'dark' | 'auto'
  /** i18n: UI + assistant reply language */
  language?: 'zh' | 'en'
  /** P0-3: user overrides for built-in tool risk classification (glob patterns) */
  toolRiskOverrides?: { pattern: string; risk: 'read' | 'write-low' | 'write-high' | 'destructive' }[]
}

const DEFAULT_SETTINGS: PetSettings = {
  animStyle: 'strands',
  // First run shows the Strands WebGL wave pet (switchable in Settings → Appearance).
  petStyle: 'strands',
  size: 'M',
  opacity: 85
}

const SIZE_MAP = {
  S: { width: 80, height: 80 },
  M: { width: 120, height: 120 },
  L: { width: 180, height: 180 }
}

export function getSizePixels(size: 'S' | 'M' | 'L'): { width: number; height: number } {
  return SIZE_MAP[size]
}

function getSettingsPath(): string {
  return scopedPath('deskapp-settings.json') // #42: account-scoped
}

export function loadSettings(): PetSettings {
  try {
    const path = getSettingsPath()
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      return { ...DEFAULT_SETTINGS, ...data }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: PetSettings): void {
  try {
    const path = getSettingsPath()
    mkdirSync(scopedDir(), { recursive: true })
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
  } catch { /* ignore */ }
}
