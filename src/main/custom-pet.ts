import { BrowserWindow } from 'electron'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const lang = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'fs'
import http from 'http'
import https from 'https'
import { scopedDir } from './account'
import type { CustomPetInfo } from '../shared/ipc-channels'
import { decodeImageDataUrl, normalizePetName, classifyByNameKeyword } from '../shared/asset-codec'

// ── Custom pet asset storage ────────────────────────────────────────────
// Library of photo-derived pets: userData/custom-pet/<id>.png (transparent
// subject) + <id>-sheet.png (procedural multi-frame spritesheet). Metadata
// lives in PetSettings.customPets (library) / .customPet (active).

function petDir(): string {
  return join(scopedDir(), 'custom-pet')
}

function petFile(id: string): string {
  return join(petDir(), `${id}.png`)
}

function sheetFile(id: string): string {
  return join(petDir(), `${id}-sheet.png`)
}

/** Resolve a saved custom pet PNG to a file:// URL. */
export function getCustomPetUrl(info: CustomPetInfo | undefined): string | null {
  if (!info) return null
  const p = petFile(info.id)
  return existsSync(p) ? pathToFileURL(p).toString() : null
}

/** Resolve the animated spritesheet for a custom pet. */
export function getCustomPetSheetUrl(info: CustomPetInfo | undefined): string | null {
  if (!info) return null
  const p = sheetFile(info.id)
  return existsSync(p) ? pathToFileURL(p).toString() : null
}

/** Persist a new pet (subject PNG + spritesheet). Returns its library entry. */
export function saveCustomPet(dataUrl: string, sheetDataUrl: string, name: string): CustomPetInfo {
  const img = decodeImageDataUrl(dataUrl)
  if (!img) throw new Error(translate(lang(), 'custompet.invalidImage'))
  const sheet = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sheetDataUrl)
  if (!sheet) throw new Error(translate(lang(), 'custompet.invalidSheet'))
  const id = Date.now().toString(36)
  mkdirSync(petDir(), { recursive: true })
  writeFileSync(petFile(id), Buffer.from(img.base64, 'base64'))
  writeFileSync(sheetFile(id), Buffer.from(sheet[1], 'base64'))
  return { id, name: normalizePetName(name), createdAt: Date.now() }
}

/** Delete one pet's files (best-effort). */
export function removeCustomPetFiles(info: CustomPetInfo): void {
  for (const p of [petFile(info.id), sheetFile(info.id)]) {
    try { unlinkSync(p) } catch { /* already gone */ }
  }
}

// ── Subject classification via a vision-capable LLM ────────────────────
// Uses the configured provider when it supports vision; otherwise probes
// well-known vision providers the user has keys for. Never required: null
// result just hides the label in the UI.

interface VisionTarget {
  provider: string
  baseURL: string
  model: string
  apiKey: string
  /** Anthropic uses /v1/messages with a different content shape */
  anthropic: boolean
}

const NON_VISION_PROVIDERS = new Set(['deepseek', 'kimi', 'moonshot'])

function readEnvKeys(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(join(process.env.HOME || '', '.hermes', '.env'), 'utf-8')
    for (const line of raw.split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (m && m[2]) out[m[1]] = m[2]
    }
  } catch { /* no .env */ }
  return out
}

/** Resolve the best vision target from current config + known keys. */
function resolveVisionTarget(): VisionTarget | null {
  const env = readEnvKeys()
  const candidates: VisionTarget[] = []

  // configured provider first (works for openai/google/custom with vision)
  try {
    const raw = readFileSync(join(process.env.HOME || '', '.hermes', 'config.yaml'), 'utf-8')
    const provider = raw.match(/provider:\s*(\S+)/)?.[1] ?? ''
    const baseURL = raw.match(/base_url:\s*(\S+)/)?.[1] ?? ''
    const model = raw.match(/default:\s*(\S+)/)?.[1] ?? ''
    if (provider && baseURL && model && !NON_VISION_PROVIDERS.has(provider)) {
      const key = provider === 'custom'
        ? raw.match(/api_key:\s*(\S+)/)?.[1]
        : env[`${provider.toUpperCase()}_API_KEY`]
      if (key) candidates.push({ provider, baseURL, model, apiKey: key, anthropic: provider === 'anthropic' })
    }
  } catch { /* no config */ }

  // well-known vision providers with keys on disk
  const fallbacks = [
    { provider: 'openai', key: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { provider: 'google', key: 'GOOGLE_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
    { provider: 'anthropic', key: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1', model: 'claude-haiku-3-5-20250514' },
  ]
  for (const f of fallbacks) {
    const key = env[f.key]
    if (key) candidates.push({ provider: f.provider, baseURL: f.baseURL, model: f.model, apiKey: key, anthropic: f.provider === 'anthropic' })
  }
  return candidates[0] ?? null
}

/** Resolve the configured chat provider (ANY provider — text classification
 *  works even without vision, e.g. DeepSeek). */
function resolveTextTarget(): { baseURL: string; model: string; apiKey: string } | null {
  try {
    const raw = readFileSync(join(process.env.HOME || '', '.hermes', 'config.yaml'), 'utf-8')
    const provider = raw.match(/provider:\s*(\S+)/)?.[1] ?? ''
    const baseURL = raw.match(/base_url:\s*(\S+)/)?.[1] ?? ''
    const model = raw.match(/default:\s*(\S+)/)?.[1] ?? ''
    if (!provider || !baseURL || !model) return null
    const key = provider === 'custom'
      ? raw.match(/api_key:\s*(\S+)/)?.[1] ?? null
      : readEnvKeys()[`${provider.toUpperCase()}_API_KEY`] ?? null
    if (!key) return null
    return { baseURL, model, apiKey: key }
  } catch {
    return null
  }
}

function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try { parsed = new URL(url) } catch { reject(new Error('bad url')); return }
    const transport = parsed.protocol === 'https:' ? https : http
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * Classify the uploaded subject ("一只橘猫", "毛绒玩具"). Layered fallback
 * (petdex-style: labels come from text when vision is unavailable):
 *   1. vision LLM (configured provider or known vision keys on disk)
 *   2. text LLM on the filename/name hint (works with ANY provider, incl.
 *      DeepSeek — mirrors petdex's text-side classification)
 *   3. local filename keyword match (zero dependencies, always works)
 * Returns null only when every layer fails.
 */
export async function classifySubject(dataUrl: string, nameHint: string): Promise<string | null> {
  // L1: vision
  const vision = resolveVisionTarget()
  if (vision) {
    try {
      const PROMPT = '识别这张图片里的主体是什么（动物/物品/人物），用中文一句话回答，例如"一只橘猫"。只回答主体名称，不要其他内容。'
      const res = vision.anthropic
        ? await postJson(
            `${vision.baseURL}/messages`,
            { model: vision.model, max_tokens: 40, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: dataUrl.split(',')[1] } }, { type: 'text', text: PROMPT }] }] },
            { 'x-api-key': vision.apiKey, 'anthropic-version': '2023-06-01' },
            20000,
          )
        : await postJson(
            `${vision.baseURL}/chat/completions`,
            { model: vision.model, max_tokens: 40, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }] },
            { Authorization: `Bearer ${vision.apiKey}` },
            20000,
          )
      if (res.status === 200) {
        const text = vision.anthropic
          ? JSON.parse(res.body).content?.[0]?.text
          : JSON.parse(res.body).choices?.[0]?.message?.content
        if (typeof text === 'string') return text.replace(/[\n\r]+/g, ' ').slice(0, 60)
      }
    } catch { /* fall through to text layers */ }
  }

  // L2: text LLM on the filename hint
  const textTarget = resolveTextTarget()
  if (textTarget && nameHint.trim()) {
    try {
      const prompt = `用户上传了一张宠物/物品照片，文件名是「${nameHint.slice(0, 80)}」。根据文件名推测照片里的主体是什么（动物/物品/人物），用中文一句话回答，例如"一只橘猫"。只回答主体名称。`
      const res = await postJson(
        `${textTarget.baseURL}/chat/completions`,
        { model: textTarget.model, max_tokens: 40, messages: [{ role: 'user', content: prompt }] },
        { Authorization: `Bearer ${textTarget.apiKey}` },
        20000,
      )
      if (res.status === 200) {
        const text = JSON.parse(res.body).choices?.[0]?.message?.content
        if (typeof text === 'string' && text.trim()) {
          const clean = text.replace(/[\n\r]+/g, ' ').trim().slice(0, 60)
          // keep the "推测" honesty marker so the user knows it's not visual
          return clean ? translate(lang(), 'custompet.guessLabel', { label: clean }) : null
        }
      }
    } catch { /* fall through to keyword layer */ }
  }

  // L3: local keyword match — always available
  const label = classifyByNameKeyword(nameHint)
  return label ? translate(lang(), 'custompet.guessLabel', { label }) : null
}

// ── Customizer window (singleton, like settings-window) ─────────────────

let customizerWindow: BrowserWindow | null = null

export function openPetCustomizerWindow(): void {
  if (customizerWindow && !customizerWindow.isDestroyed()) {
    if (customizerWindow.isMinimized()) customizerWindow.restore()
    customizerWindow.show()
    customizerWindow.focus()
    return
  }

  const preloadPath = join(__dirname, '../preload/index.js')
  const htmlPath = join(__dirname, '../renderer/index.html')

  customizerWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: true,
    title: '自定义 Desktop Pet',
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // file:// fetch of the local U2-Net model + ort wasm requires relaxed
      // web security (same policy as the pet/bubble windows; no remote content)
      webSecurity: false
    }
  })

  customizerWindow.loadFile(htmlPath, { query: { page: 'pet-customizer' } })

  customizerWindow.once('ready-to-show', () => {
    customizerWindow?.show()
  })

  customizerWindow.on('closed', () => {
    customizerWindow = null
  })

  console.log('[DeskApp] Pet customizer window created')
}

/** Ensure the customizer window is torn down on quit. */
export function closePetCustomizerWindow(): void {
  if (customizerWindow && !customizerWindow.isDestroyed()) customizerWindow.destroy()
  customizerWindow = null
}
