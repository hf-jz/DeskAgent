import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs'
import { join, basename, extname, resolve, normalize } from 'path'

let WORKSPACE_DIR = ''
// #31: extra read/list roots (root[0] is always the default workspace; writes stay there)
let EXTRA_ROOTS: string[] = []
let rootsFilePath = ''

export interface VfsFile {
  name: string; path: string; size: number; ext: string; createdAt: number
  /** #31: absolute root dir this file lives in */
  root?: string
}

/**
 * Validate that a user-supplied filename resolves inside WORKSPACE_DIR.
 * Accepts flat names AND relative subpaths (e.g. "docs/plan.md") — the
 * resolve+startsWith check below is the real guard against traversal;
 * the basename check would silently reject every subpath link.
 * Returns null if the name would escape the workspace.
 */
export function safeJoin(filename: string): string | null {
  if (typeof filename !== 'string' || filename === '' || filename === '.' || filename === '..') return null
  if (filename.includes('\\')) return null
  // 绝对路径或含 '..' 段 → 拒绝 (resolve 之后再做一次 startsWith 兜底)
  if (filename.startsWith('/') || filename.split('/').includes('..')) return null
  const candidate = join(WORKSPACE_DIR, filename)
  const resolved = normalize(resolve(candidate))
  if (!resolved.startsWith(normalize(resolve(WORKSPACE_DIR)) + '/') && resolved !== normalize(resolve(WORKSPACE_DIR))) return null
  return candidate
}

export function initVfs(appDataPath: string): string {
  WORKSPACE_DIR = join(appDataPath, 'workspace')
  mkdirSync(WORKSPACE_DIR, { recursive: true })
  rootsFilePath = join(appDataPath, 'vfs-roots.json')
  try {
    if (existsSync(rootsFilePath)) {
      const raw = JSON.parse(readFileSync(rootsFilePath, 'utf-8'))
      if (Array.isArray(raw)) EXTRA_ROOTS = raw.filter((d: any) => typeof d === 'string' && existsSync(d))
    }
  } catch { EXTRA_ROOTS = [] }
  return WORKSPACE_DIR
}

export function getWorkspaceDir(): string { return WORKSPACE_DIR }

// ── Workspace profile (declarative, idempotent) ──
//
// The workspace used to be "an empty directory the agent guesses about". A
// profile declares what the workspace is FOR: the repos it should contain and
// the goal of the environment. Borrowed from ax's Workspace manifest
// (docs/ax/01-borrow-list.md B2) minus the parts a desktop does not need:
//
//  * DeskApp does NOT clone repos itself. The agent already has a terminal in
//    this cwd and an approval flow around it; a silent network path inside the
//    app would be a new trust boundary for no added capability. The profile
//    states the expectation, the snapshot tells the agent what is missing, and
//    the agent (or the user) does the clone.
//  * local scaffolding (directories) IS ours and must be idempotent — marker
//    file, same trick ax uses to keep a resumed sandbox from re-cloning.

export const WORKSPACE_PROFILE_FILE = '.deskapp/workspace.json'
export const WORKSPACE_PROFILE_VERSION = 1

export interface WorkspaceRepo {
  /** absolute https URL, or a local path already on disk */
  repo: string
  branch?: string
  /** directory inside the workspace (defaults to the repo's basename) */
  dir?: string
}

export interface WorkspaceProfile {
  schemaVersion?: number
  name?: string
  /** plain-language description of what this environment is for */
  goal?: string
  repos?: WorkspaceRepo[]
}

export interface RepoStatus { dir: string; repo: string; present: boolean; branch?: string }

function profilePath(): string { return join(WORKSPACE_DIR, WORKSPACE_PROFILE_FILE) }

/** Read the profile; null when absent or unreadable (never throws). */
export function readWorkspaceProfile(): WorkspaceProfile | null {
  if (!WORKSPACE_DIR) return null
  try {
    if (!existsSync(profilePath())) return null
    const raw = JSON.parse(readFileSync(profilePath(), 'utf-8'))
    if (!raw || typeof raw !== 'object') return null
    return {
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : WORKSPACE_PROFILE_VERSION,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      goal: typeof raw.goal === 'string' ? raw.goal : undefined,
      repos: Array.isArray(raw.repos)
        ? raw.repos.filter((r: any) => r && typeof r.repo === 'string')
            .map((r: any) => ({ repo: r.repo, branch: r.branch, dir: r.dir }))
        : [],
    }
  } catch { return null }
}

export function writeWorkspaceProfile(profile: WorkspaceProfile): string {
  mkdirSync(join(WORKSPACE_DIR, '.deskapp'), { recursive: true })
  const body: WorkspaceProfile = { ...profile, schemaVersion: WORKSPACE_PROFILE_VERSION }
  writeFileSync(profilePath(), JSON.stringify(body, null, 2))
  return profilePath()
}

/** dir a repo is expected at (declared dir, else the URL's basename) */
export function repoDir(repo: WorkspaceRepo): string {
  if (repo.dir) return repo.dir
  const tail = repo.repo.replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop() || 'repo'
  return tail
}

/** Which declared repos are actually on disk (fs only — no network). */
export function workspaceRepoStatus(profile: WorkspaceProfile | null): RepoStatus[] {
  if (!profile?.repos?.length) return []
  return profile.repos.map((r) => {
    const dir = repoDir(r)
    const abs = join(WORKSPACE_DIR, dir)
    // A remote repo counts as present only when it is actually a clone — an
    // empty dir left by the scaffold must not read as "done". Local paths just
    // have to exist.
    const remote = /^(https?:\/\/|git@)/.test(r.repo)
    return { dir, repo: r.repo, branch: r.branch, present: remote ? existsSync(join(abs, '.git')) : existsSync(abs) }
  })
}

/**
 * Create the local scaffolding the profile declares (directories only) and
 * write a marker so a second call is a no-op. Returns what it did — callers log
 * it; nothing here touches the network.
 */
export function ensureWorkspaceScaffold(profile: WorkspaceProfile | null): { created: string[]; skipped: boolean } {
  if (!profile) return { created: [], skipped: true }
  const marker = join(WORKSPACE_DIR, '.deskapp', `initialized-v${WORKSPACE_PROFILE_VERSION}`)
  if (existsSync(marker)) return { created: [], skipped: true }
  const created: string[] = []
  for (const r of profile.repos ?? []) {
    const dir = join(WORKSPACE_DIR, repoDir(r))
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(repoDir(r)) }
  }
  mkdirSync(join(WORKSPACE_DIR, '.deskapp'), { recursive: true })
  writeFileSync(marker, JSON.stringify({ ts: Date.now(), profile: profile.name ?? null }, null, 2))
  return { created, skipped: false }
}

// ── #31: roots management ──
export function listRoots(): string[] { return [WORKSPACE_DIR, ...EXTRA_ROOTS] }

export function addRoot(dir: string): boolean {
  const norm = normalize(resolve(dir))
  if (!existsSync(norm) || !statSync(norm).isDirectory()) return false
  if (norm === normalize(resolve(WORKSPACE_DIR)) || EXTRA_ROOTS.includes(norm)) return false
  EXTRA_ROOTS.push(norm)
  writeFileSync(rootsFilePath, JSON.stringify(EXTRA_ROOTS))
  return true
}

export function removeRoot(dir: string): boolean {
  const norm = normalize(resolve(dir))
  const i = EXTRA_ROOTS.indexOf(norm)
  if (i < 0) return false
  EXTRA_ROOTS.splice(i, 1)
  writeFileSync(rootsFilePath, JSON.stringify(EXTRA_ROOTS))
  return true
}

export function listVfsFiles(): VfsFile[] {
  const files: VfsFile[] = []
  for (const root of listRoots()) {
    if (!root) continue
    for (const name of readdirSync(root)) {
      const fp = join(root, name)
      try {
        const s = statSync(fp)
        if (s.isFile()) files.push({ name, path: fp, size: s.size, ext: extname(name), createdAt: s.birthtimeMs, root })
      } catch {}
    }
  }
  return files.sort((a, b) => b.createdAt - a.createdAt)
}

export function vfsWrite(filename: string, content: string): string {
  const fp = safeJoin(filename)
  if (!fp) throw new Error(`Invalid filename: ${filename}`)
  writeFileSync(fp, content)
  return fp
}

export function vfsRead(filename: string): string | null {
  // #31: read from any root (flat names; workspace wins on collision)
  for (const root of listRoots()) {
    if (!root) continue
    const sanitized = basename(filename)
    if (sanitized !== filename || sanitized === '' || sanitized === '.' || sanitized === '..') return null
    const fp = join(root, filename)
    const resolved = normalize(resolve(fp))
    if (!resolved.startsWith(normalize(resolve(root)) + '/')) continue
    if (existsSync(fp)) return readFileSync(fp, 'utf-8')
  }
  return null
}

export function vfsImport(sourcePath: string, targetName?: string): string {
  const rawName = targetName || basename(sourcePath)
  const name = basename(rawName)
  if (!name || name === '.' || name === '..') throw new Error(`Invalid target name: ${rawName}`)
  const dest = safeJoin(name)
  if (!dest) throw new Error(`Invalid target name: ${rawName}`)
  copyFileSync(sourcePath, dest)
  return dest
}

export function vfsDelete(filename: string): boolean {
  const fp = safeJoin(filename)
  if (!fp) return false
  if (!existsSync(fp)) return false
  unlinkSync(fp)
  return true
}
