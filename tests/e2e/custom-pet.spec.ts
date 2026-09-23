import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'

/**
 * End-to-end: photo pet creation inside the real Electron app.
 *
 * Prereq: `npm run build` (electron . boots from dist/). Uses the app icon
 * as the uploaded photo. Full user journey:
 *   pet window → open customizer → upload image → auto-extract →
 *   save to library → settings broadcast → pet window switched to custom.
 */

const APP_ROOT = new URL('../..', import.meta.url).pathname

describe('custom pet e2e', () => {
  let app: ElectronApplication
  let petWin: Page
  let customizer: Page

  beforeAll(async () => {
    // isolated userData — never touches the real profile or its singleton lock
    const userData = mkdtempSync(join(tmpdir(), 'deskapp-e2e-'))
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: APP_ROOT,
      timeout: 60000,
    })
    petWin = await app.firstWindow()
    await petWin.waitForLoadState('domcontentloaded', { timeout: 30000 })
  }, 90000)

  afterAll(async () => {
    await app?.close().catch(() => {})
  })

  it('opens the customizer from the pet window', async () => {
    await petWin.evaluate(() => (window as any).deskAppAPI.openPetCustomizer())
    // windows share index.html (<title>DeskApp) — identify by query param
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      customizer = app.windows().find((w) => w.url().includes('page=pet-customizer')) as unknown as Page
      if (customizer) break
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(customizer).toBeTruthy()
    await customizer.waitForLoadState('domcontentloaded', { timeout: 20000 })
  })

  it('uploads an image and auto-extracts the subject', async () => {
    // surface renderer console (segnet warns on model/inference failures)
    const logs: string[] = []
    customizer.on('console', (msg) => {
      if (msg.text().includes('[segnet]')) logs.push(msg.text())
    })

    await customizer.setInputFiles('input[type="file"]', `${APP_ROOT}/resources/icon.png`)
    // auto-extraction runs on upload → canvas + stats render
    await customizer.waitForSelector('canvas', { timeout: 20000 })
    await customizer.waitForSelector('text=主体', { timeout: 30000 })
    // U2-Net path: the stats badge proves model + wasm + inference worked
    // (flood-fill is only the fallback when the model is unavailable)
    const aiBadge = await customizer.waitForSelector('text=AI 分割', { timeout: 20000 }).catch(() => null)
    if (!aiBadge) console.log('SEGNET LOGS:', JSON.stringify(logs))
    expect(aiBadge).toBeTruthy()
  })

  it('saves to the library and activates it across windows', async () => {
    // wait until the save button is enabled (spritesheet preview ready)
    await customizer.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('保存到宠物库'))
      return b !== undefined && !(b as HTMLButtonElement).disabled
    }, undefined, { timeout: 30000 })
    await customizer.click('text=保存到宠物库')

    // main persisted + broadcast; settings reflect the new pet and sheet url resolves
    const info = await petWin.evaluate(async () => {
      const s = await (window as any).deskAppAPI.getSettings()
      const url = s.customPet ? await (window as any).deskAppAPI.getCustomPetSheetUrl(s.customPet.id) : null
      return { petStyle: s.petStyle, name: s.customPet?.name, url, count: (s.customPets ?? []).length }
    })
    expect(info.petStyle).toBe('custom')
    expect(info.name).toBeTruthy()
    expect(info.count).toBeGreaterThanOrEqual(1)
    expect(info.url).toBeTruthy()
  })
})
