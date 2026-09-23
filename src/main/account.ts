// ── D4 #42: account-scoped storage seam (cloud-ready) ──
// Every per-user file under userData is addressed through scopedPath() so a
// future cloud layer (Auth0 PKCE + sync) can switch account without touching
// call sites. The built-in 'local' account maps to the existing flat paths —
// zero migration for current installs. Account id comes from
// userData/account.json { "id": "..." }; absent = 'local'.
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

let cachedId: string | null = null

export function currentAccountId(): string {
  if (cachedId) return cachedId
  cachedId = 'local'
  try {
    const f = join(app.getPath('userData'), 'account.json')
    if (existsSync(f)) {
      const id = String(JSON.parse(readFileSync(f, 'utf-8')).id || '').trim()
      if (/^[\w.-]{1,64}$/.test(id)) cachedId = id // strict: id becomes a dir name
    }
  } catch { /* fall back to local */ }
  return cachedId
}

/** Resolve a per-user data file for the active account. 'local' keeps the
 *  legacy flat layout (userData/<name>); any other account gets
 *  userData/accounts/<id>/<name>. */
export function scopedPath(name: string): string {
  const base = app.getPath('userData')
  const id = currentAccountId()
  return id === 'local' ? join(base, name) : join(base, 'accounts', id, name)
}

/** Directory that must exist before writing scopedPath(name). */
export function scopedDir(): string {
  const base = app.getPath('userData')
  const id = currentAccountId()
  return id === 'local' ? base : join(base, 'accounts', id)
}
