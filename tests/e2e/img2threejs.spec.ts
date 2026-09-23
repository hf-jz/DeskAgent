import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'

/**
 * End-to-end: img2threejs forge console inside the real Electron app.
 * Opens the console window, initializes a project from the app icon, and
 * asserts the 9-gate state machine renders (first gate = image-analysis).
 */

const APP_ROOT = new URL('../..', import.meta.url).pathname

describe('img2threejs console e2e', () => {
  let app: ElectronApplication
  let petWin: Page
  let consoleWin: Page
  const projectName = `e2e-${Date.now().toString(36)}`

  beforeAll(async () => {
    const userData = mkdtempSync(join(tmpdir(), 'deskapp-e2e-i23d-'))
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: APP_ROOT, timeout: 60000 })
    petWin = await app.firstWindow()
    await petWin.waitForLoadState('domcontentloaded', { timeout: 30000 })
  }, 90000)

  afterAll(async () => {
    await app?.close().catch(() => {})
    // clean up the real project dir the e2e init created under ~/3d-projects/
    try { rmSync(join(homedir(), '3d-projects', projectName), { recursive: true, force: true }) } catch { /* ok */ }
  })

  it('opens the forge console window', async () => {
    await petWin.evaluate(() => (window as any).deskAppAPI.openImg2ThreeJs())
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      consoleWin = app.windows().find((w) => w.url().includes('page=img2threejs')) as unknown as Page
      if (consoleWin) break
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(consoleWin).toBeTruthy()
    await consoleWin.waitForLoadState('domcontentloaded', { timeout: 20000 })
    await consoleWin.waitForSelector('text=流水线控制台', { timeout: 20000 })
  })

  it('initializes a project and shows the first gate', async () => {
    await consoleWin.fill('input[placeholder*="项目名"]', projectName)
    await consoleWin.fill('input[placeholder*="参考图路径"]', `${APP_ROOT}/resources/icon.png`)
    await consoleWin.click('text=🚀 初始化')
    // first mandatory gate appears + step name rendered
    await consoleWin.waitForSelector('text=image-analysis', { timeout: 30000 })
    await consoleWin.waitForSelector('text=待办步骤', { timeout: 10000 })
  })
})
