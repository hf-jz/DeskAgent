// ── P2-C1 #30: workspace trust — explicit trusted-directory list ──
// Trust state is recorded here and surfaced in settings. Enforcement of
// untrusted-workspace restrictions lands with #31 (roots risk scoping).

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let filePath: string | null = null
let cache: string[] | null = null

function path(): string {
  if (!filePath) filePath = join(app.getPath('userData'), 'trusted-workspaces.json')
  return filePath
}

function load(): string[] {
  if (cache) return cache
  cache = []
  try {
    if (existsSync(path())) {
      const raw = JSON.parse(readFileSync(path(), 'utf-8'))
      if (Array.isArray(raw)) cache = raw.filter((d: any) => typeof d === 'string')
    }
  } catch { cache = [] }
  return cache!
}

function save(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(path(), JSON.stringify(cache ?? []))
}

export function listTrusted(): string[] { return [...load()] }

export function isTrusted(dir: string): boolean {
  const norm = dir.replace(/\/+$/, '')
  return load().some(d => norm === d || norm.startsWith(d + '/'))
}

export function trustDir(dir: string): boolean {
  if (!dir.trim()) return false
  const norm = dir.trim().replace(/\/+$/, '')
  const all = load()
  if (all.includes(norm)) return false
  all.push(norm)
  save()
  return true
}

export function untrustDir(dir: string): boolean {
  const all = load()
  const i = all.indexOf(dir)
  if (i < 0) return false
  all.splice(i, 1)
  save()
  return true
}
