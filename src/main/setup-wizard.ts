import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { homedir } from 'os'
import * as http from 'http'
import * as https from 'https'
import { handleIPC } from '../shared/ipc-main'

// ── Config paths ──
const HERMES_HOME = join(homedir(), '.hermes')
const CONFIG_PATH = join(HERMES_HOME, 'config.yaml')
const ENV_PATH = join(HERMES_HOME, '.env')

/** Set restrictive file permissions (owner-only r/w) to protect API keys. */
function secureFile(path: string): void {
  try {
    // 0o600 = owner read/write only — prevents other system users from reading API keys
    chmodSync(path, 0o600)
  } catch { /* non-fatal on platforms that don't support chmod */ }
}

/**
 * Validate a provider/model slot BEFORE it is concatenated into hermes
 * config.yaml. Both writers (saveConfig, saveBrainConfig) build YAML with string
 * templates, so any value carrying a newline would inject arbitrary config keys
 * (`model: x\n  api_key: evil`) — and an empty model / bogus URL leaves hermes
 * unable to start, which surfaces later as an unrelated-looking turn failure.
 * Returns human-readable errors; empty array = valid. Pure, unit-tested.
 */
export function validateSlot(slot: BrainSlotConfig): string[] {
  const errs: string[] = []
  const provider = String(slot.provider ?? '').trim()
  const model = String(slot.model ?? '').trim()
  const baseURL = String(slot.baseURL ?? '').trim()
  const apiKey = String(slot.apiKey ?? '').trim()

  if (!provider) errs.push('provider 不能为空')
  else if (!/^[a-z0-9._-]+$/.test(provider)) errs.push(`provider 只能是 a-z 0-9 . _ -（收到 ${JSON.stringify(slot.provider)}）`)

  if (!model) errs.push('model 不能为空')
  else if (!/^[A-Za-z0-9._:/@+~-]+$/.test(model)) errs.push(`model 含非法字符（收到 ${JSON.stringify(slot.model)}）`)

  if (apiKey && !/^\S+$/.test(slot.apiKey)) errs.push('api_key 不能含空白字符')

  if (baseURL) {
    let parsed: URL | null = null
    try { parsed = new URL(baseURL) } catch { parsed = null }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) errs.push(`base_url 必须是 http(s) URL（收到 ${JSON.stringify(slot.baseURL)}）`)
  } else if (provider === 'custom') {
    errs.push('自定义 provider 必须填 base_url')
  }
  return errs
}

/** Map provider IDs to their canonical environment variable names.
 *  Only well-known providers get env-var storage; custom providers
 *  keep api_key inline in config.yaml (the Hermes convention). */
const PROVIDER_ENV_VAR: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  google: 'GOOGLE_API_KEY',
  'kimi-coding-cn': 'KIMI_CN_API_KEY',
  kimi: 'KIMI_API_KEY',
}

/** Write or update a single KEY=VALUE line in ~/.hermes/.env.
 *  Preserves other lines and comments; updates an existing key in-place
 *  or appends.  Never deletes or reorders unrelated entries. */
function saveEnvVar(key: string, value: string): void {
  mkdirSync(HERMES_HOME, { recursive: true })
  let content = ''
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, 'utf-8')
  }
  // Escape value for safe .env embedding — only $ and backslash need escaping in
  // single-quoted values; newlines are rejected outright (should never occur).
  const safeValue = value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')
  const newLine = `${key}=${safeValue}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) {
    content = content.replace(re, newLine)
  } else {
    content = content.trimEnd() + '\n' + newLine + '\n'
  }
  writeFileSync(ENV_PATH, content, 'utf-8')
  secureFile(ENV_PATH)
}

// ── Provider presets ──
export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  models: string[]
  defaultModel: string
  plannerModel: string   // frontier model — decomposes complex goals
  workerModel: string    // cheap model — executes concrete tasks
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai', name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini', 'o3'],
    defaultModel: 'gpt-4o',
    plannerModel: 'gpt-4.1',
    workerModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic', name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-5-20250514'],
    defaultModel: 'claude-sonnet-4-20250514',
    plannerModel: 'claude-sonnet-4-20250514',
    workerModel: 'claude-haiku-3-5-20250514',
  },
  {
    id: 'deepseek', name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    // Verified against GET /models 2026-07 — deepseek-chat/reasoner are gone
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    defaultModel: 'deepseek-v4-pro',
    plannerModel: 'deepseek-v4-pro',
    workerModel: 'deepseek-v4-flash',
  },
  {
    id: 'moonshot', name: 'Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    // Verified against GET /models 2026-07
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'kimi-k3',
    plannerModel: 'kimi-k3',
    workerModel: 'kimi-k2.7-code',
  },
  {
    id: 'google', name: 'Google AI',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    plannerModel: 'gemini-2.5-pro',
    workerModel: 'gemini-2.5-flash',
  },
  {
    id: 'custom', name: 'Custom / OpenAI-compatible',
    baseURL: '',
    models: [],
    defaultModel: '',
    plannerModel: '',
    workerModel: '',
  },
]

// ── Config ──

export interface LLMConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
}

/** Check if user has configured an LLM provider */
export function needsSetup(): boolean {
  try {
    if (!existsSync(CONFIG_PATH)) return true
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    // Check for model.default
    const hasModel = /default:\s*\S+/.test(raw)
    if (!hasModel) return true
    // Inline api_key in config.yaml → configured
    if (/api_key:\s*\S+/.test(raw)) return false
    // Provider preset + key living in ~/.hermes/.env (e.g. kimi-coding-cn → KIMI_CN_API_KEY)
    const provider = raw.match(/provider:\s*(\S+)/)?.[1] ?? ''
    const envMap: Record<string, string[]> = {
      'kimi-coding-cn': ['KIMI_CN_API_KEY'],
      kimi: ['KIMI_API_KEY'],
      moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      google: ['GOOGLE_API_KEY'],
    }
    const envPath = join(HERMES_HOME, '.env')
    if (existsSync(envPath)) {
      const envRaw = readFileSync(envPath, 'utf-8')
      const vars = envMap[provider] ?? []
      if (vars.some(v => new RegExp('^' + v + '=\\S+', 'm').test(envRaw))) return false
    }
    return true
  } catch {
    return true
  }
}

/** Read current config from hermes config.yaml */
export function readExistingConfig(): Partial<LLMConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const cfg: Partial<LLMConfig> = {}
    const m = raw.match(/provider:\s*(\S+)/)
    if (m) cfg.provider = m[1]
    const bu = raw.match(/base_url:\s*(\S+)/)
    if (bu) cfg.baseURL = bu[1]
    const d = raw.match(/default:\s*(\S+)/)
    if (d) cfg.model = d[1]
    const k = raw.match(/api_key:\s*(\S+)/)
    if (k) cfg.apiKey = '••••••••' // don't expose real key
    return cfg
  } catch {
    return {}
  }
}

/** Save config to hermes config.yaml. Refuses to write invalid values — a bad
 *  provider/model/URL here is only discovered later as a broken turn. */
export function saveConfig(config: LLMConfig, providerId: string): { ok: boolean; errors?: string[] } {
  const errors = validateSlot({ provider: providerId, model: config.model, baseURL: config.baseURL, apiKey: config.apiKey })
  if (errors.length) return { ok: false, errors }
  mkdirSync(HERMES_HOME, { recursive: true })

  // Read existing config to preserve other settings
  let existing = ''
  if (existsSync(CONFIG_PATH)) {
    existing = readFileSync(CONFIG_PATH, 'utf-8')
  }

  // Build model section
  const modelSection = [
    'model:',
    `  default: ${config.model}`,
    `  provider: ${providerId}`,
  ]
  if (config.baseURL && providerId === 'custom') {
    modelSection.push(`  base_url: ${config.baseURL}`)
  }
  // API key: for well-known providers write to .env (keeps secrets out of config.yaml);
  // for custom providers keep inline (no canonical env var exists).
  if (config.apiKey) {
    const envVar = PROVIDER_ENV_VAR[providerId]
    if (envVar) {
      saveEnvVar(envVar, config.apiKey)
    } else {
      modelSection.push(`  api_key: ${config.apiKey}`)
    }
  }
  modelSection.push('')

  // If no existing config, write minimal
  if (!existing) {
    const minimal = [
      ...modelSection,
      'providers: {}',
      'fallback_providers: []',
      'toolsets:',
      '- hermes-cli',
      '',
      'agent:',
      '  max_turns: 500',
      '  gateway_timeout: 1800',
      '',
    ].join('\n')
    writeFileSync(CONFIG_PATH, minimal, 'utf-8')
    secureFile(CONFIG_PATH)
    return { ok: true }
  }

  // Replace or insert model section in existing config
  if (/^model:/m.test(existing)) {
    // Replace existing model block
    existing = existing.replace(
      /^model:\n(?:[^\S\n].*\n?|\n)*/m,
      modelSection.join('\n').trimEnd() + '\n',
    )
  } else {
    // Prepend model section
    existing = modelSection.join('\n') + existing
  }

  writeFileSync(CONFIG_PATH, existing, 'utf-8')
  secureFile(CONFIG_PATH)
  return { ok: true }
}

// ── Planner/Worker brain config ──

export interface BrainSlotConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
}

function brainSection(key: 'model' | 'delegation', slot: BrainSlotConfig): string {
  const lines = [key + ':']
  lines.push(key === 'model' ? `  default: ${slot.model}` : `  model: ${slot.model}`)
  lines.push(`  provider: ${slot.provider}`)
  if (slot.baseURL && slot.provider === 'custom') lines.push(`  base_url: ${slot.baseURL}`)
  // api_key handled by saveBrainConfig — saved to .env for well-known providers
  return lines.join('\n')
}

function upsertYamlSection(raw: string, key: string, section: string): string {
  const re = new RegExp(`^${key}:\\n(?:[^\\S\\n].*\\n?|\\n)*`, 'm')
  if (re.test(raw)) return raw.replace(re, section.trimEnd() + '\n')
  return section + '\n\n' + raw
}

/**
 * Save the dual-model brain: model.* = Planner (frontier, decomposes goals),
 * delegation.* = Worker (cheap, executes tasks). Two providers → two keys;
 * same provider → one key, two model tiers.
 */
export function saveBrainConfig(planner: BrainSlotConfig, worker: BrainSlotConfig): { ok: boolean; errors?: string[] } {
  // Validate both slots before touching config.yaml (see validateSlot)
  const errors = [
    ...validateSlot(planner).map((e) => `planner: ${e}`),
    ...validateSlot(worker).map((e) => `worker: ${e}`),
  ]
  if (errors.length) return { ok: false, errors }
  mkdirSync(HERMES_HOME, { recursive: true })

  // Save API keys to .env for well-known providers BEFORE writing config.yaml.
  // This keeps secrets out of the config file (which may be less protected or
  // accidentally committed).  Custom providers still get api_key inline.
  for (const slot of [planner, worker]) {
    if (slot.apiKey) {
      const envVar = PROVIDER_ENV_VAR[slot.provider]
      if (envVar) saveEnvVar(envVar, slot.apiKey)
    }
  }

  let raw = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : ''
  raw = upsertYamlSection(raw, 'model', brainSection('model', planner))
  raw = upsertYamlSection(raw, 'delegation', brainSection('delegation', worker))
  writeFileSync(CONFIG_PATH, raw, 'utf-8')
  secureFile(CONFIG_PATH)
  return { ok: true }
}

/**
 * Update ONLY the model names in config.yaml (model.default and delegation.model).
 * Preserves provider, base_url, api_key, and all other fields.
 * ponytail: regex replace on the two target lines — no YAML parser, no section rewrite.
 */
export function updateModelNames(plannerModel: string, workerModel: string): void {
  if (!existsSync(CONFIG_PATH)) return
  let raw = readFileSync(CONFIG_PATH, 'utf-8')
  raw = raw.replace(/^(model:\n  default: )[^\n]+/m, `$1${plannerModel}`)
  raw = raw.replace(/^(delegation:\n  model: )[^\n]+/m, `$1${workerModel}`)
  writeFileSync(CONFIG_PATH, raw, 'utf-8')
  secureFile(CONFIG_PATH)
}

export interface BrainSlotInfo {
  provider: string
  model: string
  baseURL: string
}

/** Read current planner/worker config from config.yaml (no API keys exposed). */
export function readBrainConfig(): { planner: BrainSlotInfo; worker: BrainSlotInfo } {
  const raw = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : ''
  const pick = (section: string, field: string): string => {
    const m = raw.match(new RegExp(`^${section}:\\n  ${field}: (.+)`, 'm'))
    return m ? m[1] : ''
  }
  return {
    planner: {
      provider: pick('model', 'provider'),
      model: pick('model', 'default'),
      baseURL: pick('model', 'base_url'),
    },
    worker: {
      provider: pick('delegation', 'provider'),
      model: pick('delegation', 'model'),
      baseURL: pick('delegation', 'base_url'),
    },
  }
}

/** Test connection to the configured API */
export function testConnection(config: LLMConfig): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    // Reject non-HTTPS URLs — never send API keys over cleartext.
    let parsed: URL
    try { parsed = new URL(config.baseURL + '/models') } catch {
      resolve({ success: false, message: 'Invalid base URL' })
      return
    }
    if (parsed.protocol !== 'https:') {
      resolve({ success: false, message: 'API connection must use HTTPS. Please use an https:// base URL.' })
      return
    }
    const transport = parsed.protocol === 'https:' ? https : http

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 401) {
            // 401 means API key is wrong, but endpoint is reachable
            if (res.statusCode === 200) {
              resolve({ success: true, message: 'Connection successful' })
            } else {
              try {
                const err = JSON.parse(body)
                resolve({ success: false, message: err.error?.message || 'Invalid API key' })
              } catch {
                resolve({ success: false, message: 'Invalid API key' })
              }
            }
          } else {
            resolve({ success: false, message: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` })
          }
        })
      },
    )

    req.on('error', (err) => {
      resolve({ success: false, message: `Connection failed: ${err.message}` })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, message: 'Connection timed out' })
    })

    req.end()
  })
}

// ── Setup IPC (window-agnostic; the conversational onboarding in the bubble
// uses these same handlers, and the legacy standalone wizard is no longer
// auto-shown at first launch) ──

export function registerSetupHandlers(): void {
  handleIPC('setup:save', (_e, config, providerId) => {
    return saveConfig(config, providerId)
  })

  handleIPC('setup:save-brain', (_e, planner, worker) => {
    return saveBrainConfig(planner, worker)
  })

  handleIPC('settings:get-brain-config', () => readBrainConfig())

  handleIPC('setup:test', (_e, config) => {
    return testConnection(config)
  })

  // Orphan handlers — no preload endpoint; kept as raw ipcMain for compatibility
  ipcMain.handle('setup:get-existing', () => {
    return { needsSetup: needsSetup(), existing: readExistingConfig(), providers: PROVIDERS }
  })

  ipcMain.handle('setup:skip', () => {
    return { ok: true }
  })
}

// Note: the legacy standalone setup window was removed — the inline
// OnboardingCard in the bubble is the single setup path.
