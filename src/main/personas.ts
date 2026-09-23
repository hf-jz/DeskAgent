// ── P2-C3 #26: persona manifests — named system-prefix presets ──
// One active persona at a time; its systemPrefix is injected into every turn
// context (context.ts). Ponytail: global (per-app) active persona, not per-agent.
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface Persona {
  id: string
  name: string
  /** injected as a [人格设定] block at the top of every turn context */
  systemPrefix: string
}

let personas: Persona[] = []
let activeId: string | null = null
let filePath = ''

function file(): string {
  if (!filePath) filePath = join(app.getPath('userData'), 'personas.json')
  return filePath
}

function load(): void {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf-8'))
    personas = Array.isArray(raw.personas) ? raw.personas : []
    activeId = typeof raw.activeId === 'string' ? raw.activeId : null
  } catch { personas = []; activeId = null }
}

function save(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file(), JSON.stringify({ personas, activeId }, null, 2))
  } catch { /* non-fatal */ }
}

export function listPersonas(): { personas: Persona[]; activeId: string | null } {
  if (!filePath) load()
  return { personas: [...personas], activeId }
}

export function savePersona(p: Omit<Persona, 'id'> & { id?: string }): Persona {
  if (!filePath) load()
  const existing = p.id ? personas.find(x => x.id === p.id) : undefined
  if (existing) {
    existing.name = p.name.slice(0, 50)
    existing.systemPrefix = p.systemPrefix.slice(0, 2000)
    save()
    return existing
  }
  const created: Persona = { id: `p-${Date.now()}`, name: p.name.slice(0, 50), systemPrefix: p.systemPrefix.slice(0, 2000) }
  personas.push(created)
  if (!activeId) activeId = created.id
  save()
  return created
}

export function deletePersona(id: string): boolean {
  if (!filePath) load()
  const i = personas.findIndex(x => x.id === id)
  if (i < 0) return false
  personas.splice(i, 1)
  if (activeId === id) activeId = personas[0]?.id ?? null
  save()
  return true
}

export function setActivePersona(id: string | null): boolean {
  if (!filePath) load()
  if (id && !personas.some(x => x.id === id)) return false
  activeId = id
  save()
  return true
}

/** Called by context.ts on every turn — empty string when no active persona. */
export function getActivePersonaPrefix(): string {
  if (!filePath) load()
  const p = personas.find(x => x.id === activeId)
  return p ? p.systemPrefix : ''
}
