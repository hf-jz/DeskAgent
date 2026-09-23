import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { parseForgeOutput, type ForgeStepState } from '../shared/img2threejs-parser'

// ── img2threejs forge bridge ────────────────────────────────────────────
// Spawns the zero-dependency forge state machine (python3 stdlib only) and
// turns its LOCAL_STATE/STATE stdout into structured state for the console
// window. Projects live in ~/3d-projects/<name>/.

export const FORGE_DIR = join(homedir(), 'web', 'img2threejs')

function projectsRoot(): string {
  return join(homedir(), '3d-projects')
}

export function projectDirFor(name: string): string {
  return join(projectsRoot(), name.replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 40))
}

function runForge(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolvePromise) => {
    execFile(
      'python3',
      args,
      { cwd: FORGE_DIR, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0
        resolvePromise({ stdout: stdout || '', code })
      },
    )
  })
}

/** Initialize a forge project from a reference image. */
export async function initProject(reference: string, projectName: string, profile: string): Promise<{ state: ForgeStepState; projectDir: string }> {
  const dir = projectDirFor(projectName)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, '.img2threejs'), { recursive: true })
  const statePath = join(dir, '.img2threejs', 'state.json')
  const { stdout } = await runForge([
    'forge/state.py', 'init',
    '--state', statePath,
    '--reference', reference,
    '--profile', profile,
  ])
  return { state: parseForgeOutput(stdout), projectDir: dir }
}

/** Current step / pending checklist. */
export async function readStatus(projectDir: string): Promise<ForgeStepState | null> {
  const statePath = join(projectDir, '.img2threejs', 'state.json')
  if (!existsSync(statePath)) return null
  const { stdout } = await runForge(['forge/next.py', '--state', statePath])
  return parseForgeOutput(stdout)
}

/** Mark a step done (with optional evidence file), then report the next step. */
export async function markAndNext(projectDir: string, step: string): Promise<ForgeStepState | null> {
  const statePath = join(projectDir, '.img2threejs', 'state.json')
  if (!existsSync(statePath)) return null
  await runForge(['forge/state.py', 'mark', step, '--state', statePath])
  const { stdout } = await runForge(['forge/next.py', '--state', statePath])
  return parseForgeOutput(stdout)
}

const ARTIFACT_KINDS: [RegExp, string][] = [
  [/(spec|contract)\.json$/, 'spec'],
  [/\.(html?|tsx?)$/, 'code'],
  [/\.(png|jpe?g|webp)$/, 'image'],
  [/\.(glb|gltf)$/, 'model'],
  [/(state\.json)$/, 'state'],
]

/** Discover build artifacts under the project dir (recursive, shallow). */
export function listArtifacts(projectDir: string): { name: string; path: string; kind: string }[] {
  if (!existsSync(projectDir)) return []
  const out: { name: string; path: string; kind: string }[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (entry.startsWith('.') && entry !== '.img2threejs') continue
      if (entry === 'node_modules') continue
      const full = join(dir, entry)
      let isDir = false
      try { isDir = statSync(full).isDirectory() } catch { continue }
      if (isDir) {
        walk(full, depth + 1)
      } else {
        const kind = ARTIFACT_KINDS.find(([re]) => re.test(entry))?.[1] ?? 'file'
        out.push({ name: entry, path: full, kind })
      }
    }
  }
  walk(projectDir, 0)
  return out
}

export function openArtifact(path: string): void {
  if (existsSync(path)) shell.openPath(path)
}

// ── Console window (singleton, mirrors create-window factory style) ─────

let consoleWin: BrowserWindow | null = null

export function openImg2ThreeJsWindow(): void {
  if (consoleWin && !consoleWin.isDestroyed()) {
    if (consoleWin.isMinimized()) consoleWin.restore()
    consoleWin.show()
    consoleWin.focus()
    return
  }
  const preloadPath = join(__dirname, '../preload/index.js')
  consoleWin = new BrowserWindow({
    width: 1000, height: 720,
    minWidth: 760, minHeight: 540,
    show: false, frame: true, title: 'img2threejs 流水线控制台',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // file:// previews of generated HTML artifacts need relaxed security
      webSecurity: false,
    },
  })
  consoleWin.loadFile(join(__dirname, '../renderer/index.html'), { query: { page: 'img2threejs' } })
  consoleWin.once('ready-to-show', () => consoleWin?.show())
  consoleWin.on('closed', () => { if (consoleWin) consoleWin = null })
}

export function closeImg2ThreeJsWindow(): void {
  if (consoleWin && !consoleWin.isDestroyed()) consoleWin.destroy()
  consoleWin = null
}
