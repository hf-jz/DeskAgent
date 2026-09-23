/**
 * Skill Store — manages the canonical skill registry at ~/.deskapp/skills/
 *
 * Directory layout:
 *   ~/.deskapp/skills/
 *     index.json              ← skill registry (lightweight)
 *     {category}/
 *       {skill-name}/
 *         SKILL.canonical.md  ← full canonical definition (YAML frontmatter + MD)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { CanonicalSkill, SkillIndex, SkillIndexEntry, AgentId } from './types'

const SKILLS_DIR = join(
  process.env.HOME || '/tmp',
  '.deskapp',
  'skills',
)

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

// ── Lightweight YAML frontmatter parser (no js-yaml dependency) ──
// Handles: string, number, boolean, array of strings, simple objects with string values.

function parseYamlValue(v: string): any {
  v = v.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

function parseSimpleYaml(text: string): Record<string, any> {
  const result: Record<string, any> = {}
  const lines = text.split('\n')
  let currentKey = ''
  let currentList: string[] = []
  let inList = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // List item: - value
    const listMatch = line.match(/^-\s+(.+)$/)
    if (listMatch && inList && currentKey) {
      currentList.push(listMatch[1].trim())
      continue
    }

    // Flush previous list
    if (inList && currentKey) {
      result[currentKey] = currentList
      currentList = []
      inList = false
      currentKey = ''
    }

    // Simple key: value or key:
    const kvMatch = line.match(/^([a-zA-Z_][\w]*)\s*:\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      const val = kvMatch[2].trim()
      if (val === '') {
        // Could be start of a list
        currentKey = key
        currentList = []
        inList = true
      } else if (val === '{}') {
        result[key] = {}
      } else {
        result[key] = parseYamlValue(val)
      }
    }
  }
  // Flush trailing list
  if (inList && currentKey) {
    result[currentKey] = currentList
  }
  return result
}

// ── Frontmatter parsing ──

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseCanonical(raw: string): CanonicalSkill | null {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return null
  try {
    const fm = parseSimpleYaml(m[1]) as any
    return {
      name: fm.name || '',
      version: fm.version || '0.1.0',
      author: fm.author || 'unknown',
      category: fm.category || 'uncategorized',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      trigger: fm.trigger || '',
      description: fm.description || '',
      instructions: m[2].trim(),
      adapters: fm.adapters || {},
      active: fm.active !== false,
      activeFor: Array.isArray(fm.activeFor) ? fm.activeFor : ['hermes'],
      // #25: declared capabilities (e.g. network/exec) — consent-gated on enable
      capabilities: Array.isArray(fm.capabilities) ? fm.capabilities.filter((c: any) => typeof c === 'string') : undefined,
      installedAt: fm.installedAt || undefined,
      updatedAt: fm.updatedAt || undefined,
      source: fm.source || 'local',
    }
  } catch {
    return null
  }
}

function serializeCanonical(s: CanonicalSkill): string {
  const fm: Record<string, any> = {
    name: s.name,
    version: s.version,
    author: s.author,
    category: s.category,
  }
  if (s.tags.length) fm.tags = s.tags
  if (s.trigger) fm.trigger = s.trigger
  if (s.description) fm.description = s.description
  if (s.adapters && Object.keys(s.adapters).length) fm.adapters = s.adapters
  fm.active = s.active
  fm.activeFor = s.activeFor
  if (s.installedAt) fm.installedAt = s.installedAt
  if (s.updatedAt) fm.updatedAt = s.updatedAt
  if (s.source) fm.source = s.source

  const fmLines: string[] = ['---']
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      fmLines.push(`${k}:`)
      for (const item of v) fmLines.push(`  - ${item}`)
    } else if (typeof v === 'object' && v !== null) {
      fmLines.push(`${k}: {}`)
    } else if (typeof v === 'boolean') {
      fmLines.push(`${k}: ${v}`)
    } else {
      fmLines.push(`${k}: ${String(v)}`)
    }
  }
  fmLines.push('---')
  fmLines.push('')
  fmLines.push(s.instructions)
  return fmLines.join('\n')
}

// ── Path helpers ──

function skillDir(name: string, category: string): string {
  return join(SKILLS_DIR, category, name)
}

function skillPath(name: string, category: string): string {
  return join(skillDir(name, category), 'SKILL.canonical.md')
}

// ── CRUD ──

export function loadIndex(): SkillIndex {
  const p = join(SKILLS_DIR, 'index.json')
  if (!existsSync(p)) return { version: 1, updatedAt: new Date().toISOString(), skills: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), skills: [] }
  }
}

function saveIndex(idx: SkillIndex): void {
  idx.updatedAt = new Date().toISOString()
  ensureDir(SKILLS_DIR)
  writeFileSync(join(SKILLS_DIR, 'index.json'), JSON.stringify(idx, null, 2))
}

export function installSkill(skill: CanonicalSkill): void {
  const dir = skillDir(skill.name, skill.category)
  ensureDir(dir)
  skill.installedAt = new Date().toISOString()
  skill.updatedAt = skill.installedAt
  const content = serializeCanonical(skill)
  writeFileSync(skillPath(skill.name, skill.category), content, 'utf-8')

  const idx = loadIndex()
  const existing = idx.skills.findIndex(s => s.name === skill.name)
  const entry = skillToEntry(skill)
  if (existing >= 0) idx.skills[existing] = entry
  else idx.skills.push(entry)
  saveIndex(idx)
}

export function getSkill(name: string): CanonicalSkill | null {
  const idx = loadIndex()
  const entry = idx.skills.find(s => s.name === name)
  if (!entry) return null
  // Try index category path first, then scan filesystem
  let p: string | null = skillPath(entry.name, entry.category)
  if (!existsSync(p)) {
    p = findSkillFile(name)
  }
  if (!p || !existsSync(p)) return null
  try {
    return parseCanonical(readFileSync(p, 'utf-8'))
  } catch { return null } // unreadable (permissions / just deleted) → treat as absent
}

function findSkillFile(name: string): string | null {
  if (!existsSync(SKILLS_DIR)) return null
  let cats: string[]
  try { cats = readdirSync(SKILLS_DIR) } catch { return null }
  for (const cat of cats) {
    // Fail-safe discovery (ax's local.Discover): a broken symlink, an
    // unreadable directory or a race must skip that entry, never throw — one
    // bad entry in the skills dir would otherwise break every skill lookup
    // (the bulk sync already has its own failed[] guard).
    try {
      const catDir = join(SKILLS_DIR, cat)
      if (!statSync(catDir).isDirectory()) continue
      const f = join(catDir, name, 'SKILL.canonical.md')
      if (existsSync(f)) return f
    } catch { continue }
  }
  return null
}

export function listSkills(): SkillIndexEntry[] {
  return loadIndex().skills
}

export function removeSkill(name: string): boolean {
  const idx = loadIndex()
  const entry = idx.skills.find(s => s.name === name)
  if (!entry) return false
  const dir = skillDir(entry.name, entry.category)
  if (existsSync(dir)) {
    const { rmSync } = require('fs')
    rmSync(dir, { recursive: true, force: true })
  }
  idx.skills = idx.skills.filter(s => s.name !== name)
  saveIndex(idx)
  return true
}

export function setSkillActive(name: string, active: boolean, agent?: AgentId): void {
  const skill = getSkill(name)
  if (!skill) return
  if (agent) {
    if (active) {
      if (!skill.activeFor.includes(agent)) skill.activeFor.push(agent)
    } else {
      skill.activeFor = skill.activeFor.filter(a => a !== agent)
    }
  }
  skill.active = active
  skill.updatedAt = new Date().toISOString()
  const content = serializeCanonical(skill)
  writeFileSync(skillPath(skill.name, skill.category), content, 'utf-8')

  const idx = loadIndex()
  const existing = idx.skills.findIndex(s => s.name === name)
  if (existing >= 0) idx.skills[existing] = skillToEntry(skill)
  saveIndex(idx)
}

function skillToEntry(s: CanonicalSkill): SkillIndexEntry {
  return {
    name: s.name,
    version: s.version,
    category: s.category,
    tags: s.tags,
    description: s.description,
    active: s.active,
    activeFor: s.activeFor,
    capabilities: s.capabilities,
    installedAt: s.installedAt,
  }
}

// ── Hermes sync: canonical → hermes SKILL.md ──

export function syncToHermes(name: string): boolean {
  const skill = getSkill(name)
  if (!skill) return false
  const hermesDir = join(
    process.env.HOME || '/tmp',
    '.hermes',
    'skills',
    skill.category,
    skill.name,
  )
  ensureDir(hermesDir)

  const adapter = skill.adapters?.hermes
  const fmLines: string[] = ['---']
  fmLines.push(`name: ${skill.name}`)
  fmLines.push(`description: ${skill.description}`)
  if (skill.version) fmLines.push(`version: ${skill.version}`)
  if (skill.author) fmLines.push(`author: ${skill.author}`)
  if (skill.trigger) fmLines.push(`trigger: ${skill.trigger}`)
  if (skill.tags.length) {
    fmLines.push('tags:')
    for (const t of skill.tags) fmLines.push(`  - ${t}`)
  }
  fmLines.push('---')
  fmLines.push('')
  fmLines.push(skill.instructions)
  if (adapter?.extraInstructions) {
    fmLines.push('')
    fmLines.push(adapter.extraInstructions)
  }

  writeFileSync(join(hermesDir, 'SKILL.md'), fmLines.join('\n'), 'utf-8')
  return true
}

export function syncAllToHermes(): { synced: number; failed: string[] } {
  const idx = loadIndex()
  let synced = 0
  const failed: string[] = []
  for (const entry of idx.skills) {
    if (!entry.active || !entry.activeFor.includes('hermes')) continue
    if (syncToHermes(entry.name)) synced++
    else failed.push(entry.name)
  }
  return { synced, failed }
}

export { SKILLS_DIR }
