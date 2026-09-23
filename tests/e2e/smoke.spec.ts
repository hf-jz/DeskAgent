import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'

/**
 * End-to-end smoke: does the whole local chain still work?
 *
 * This is the scripted version of `docs/ax/04-*.md` D4 (ax's demo.sh): boot the
 * real app on an isolated profile, run the environment self-check the setup
 * wizard relies on, and prove the windows/IPC a user needs actually come up.
 * Deliberately NO LLM turn — that costs tokens and flakes; `.env`-level chain
 * (engine bundle, python, workspace, model config, runners, memory guard) is
 * what breaks silently after a refactor.
 *
 * Prereq: `npm run build` (the app boots from dist/). Run: `npm run test:e2e`.
 */

const APP_ROOT = new URL('../..', import.meta.url).pathname

// checks doctor.ts must always report — a rename that silently drops one of
// these is exactly the regression this test exists to catch
const REQUIRED_CHECKS = ['engine bundle', 'python for engine', 'workspace', 'model config', 'agent runners', 'memory guard']

describe('smoke', () => {
  let app: ElectronApplication
  let petWin: Page

  beforeAll(async () => {
    const userData = mkdtempSync(join(tmpdir(), 'deskapp-smoke-'))
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: APP_ROOT, timeout: 60000 })
    petWin = await app.firstWindow()
    await petWin.waitForLoadState('domcontentloaded', { timeout: 30000 })
  }, 90000)

  afterAll(async () => {
    await app?.close().catch(() => {})
  })

  it('boots the pet window and answers IPC', async () => {
    const sessions = await petWin.evaluate(() => (window as any).deskAppAPI.listSessions())
    expect(Array.isArray(sessions)).toBe(true)
  })

  it('runs the environment self-check clean', async () => {
    const report = await petWin.evaluate(() => (window as any).deskAppAPI.runDoctor())
    for (const c of report.checks) {
      // name + verdict in the failure message, so a red CI line is self-explaining
      expect(`${c.name}: ${c.detail}`, `${c.name} failed`).toBeTruthy()
      expect(c.ok, `${c.name} → ${c.detail}${c.hint ? ` | ${c.hint}` : ''}`).toBe(true)
    }
    for (const want of REQUIRED_CHECKS) {
      expect(report.checks.map((c: { name: string }) => c.name)).toContain(want)
    }
    expect(report.ok).toBe(true)
  })

  it('prepares the workspace directory on a fresh profile', async () => {
    const dir = await petWin.evaluate(() => (window as any).deskAppAPI.runDoctor())
      .then((r: { checks: { name: string; detail: string }[] }) =>
        r.checks.find((c) => c.name === 'workspace')?.detail ?? '')
    expect(dir).toContain('MB free')
    // isolated profile → no profile declared, doctor must say so instead of failing
    expect(dir).toContain('no profile')
  })

  it('opens a bubble window (the path every turn goes through)', async () => {
    const before = app.windows().length
    await petWin.evaluate(() => (window as any).deskAppAPI.openBubble())
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && app.windows().length === before) {
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(app.windows().length).toBeGreaterThan(before)
    const bubble = app.windows()[app.windows().length - 1]
    await bubble.waitForLoadState('domcontentloaded', { timeout: 20000 })
    expect(await bubble.title()).toBeTruthy()
  })
})
