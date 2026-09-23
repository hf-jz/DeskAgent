// ── P2-C1 #29: secrets — safeStorage-encrypted named secrets ──
// Values are encrypted via Electron safeStorage (Keychain on macOS) and stored
// in userData/secrets.json as { name: 'ss:...' }. The list channel returns
// names only — values never cross IPC.

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { encrypt, decrypt } from './habit/crypto'
import { scopedPath, scopedDir } from './account'

let filePath: string | null = null
let cache: Record<string, string> | null = null

function path(): string {
  if (!filePath) filePath = scopedPath('secrets.json') // #42: account-scoped
  return filePath
}

function load(): Record<string, string> {
  if (cache) return cache
  cache = {}
  try {
    if (existsSync(path())) cache = JSON.parse(readFileSync(path(), 'utf-8'))
  } catch { cache = {} }
  return cache!
}

function save(): void {
  mkdirSync(scopedDir(), { recursive: true })
  writeFileSync(path(), JSON.stringify(cache ?? {}), { mode: 0o600 })
}

export function listSecrets(): string[] { return Object.keys(load()).sort() }

export function setSecret(name: string, value: string): boolean {
  if (!name.trim() || !value) return false
  const enc = encrypt(value)
  if (!enc) return false  // fail-closed: never store plaintext
  load()[name.trim()] = enc
  save()
  return true
}

export function deleteSecret(name: string): boolean {
  const all = load()
  if (!(name in all)) return false
  delete all[name]
  save()
  return true
}

/** Main-process only — used to inject secrets into agent environments later. */
export function getSecret(name: string): string | null {
  const enc = load()[name]
  if (!enc) return null
  const v = decrypt(enc)
  return v || null
}
