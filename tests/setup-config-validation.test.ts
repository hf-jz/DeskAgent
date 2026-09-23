import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Both writers of ~/.hermes/config.yaml build the YAML with string templates,
 * so an unvalidated value is both a config-injection vector (newline in a model
 * name) and a way to leave hermes unable to start. These assertions pin the
 * guard: invalid input is refused, nothing is written, valid input still works.
 *
 * HERMES_HOME is fixed at import time, so HOME is redirected to a scratch tree
 * and the module imported dynamically (electron mocked — it only needs ipcMain
 * at registration time).
 */

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

let home: string
let sw: typeof import('../src/main/setup-wizard')
const configPath = () => join(home, '.hermes', 'config.yaml')

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'deskapp-hermes-'))
  process.env.HOME = home
  sw = await import('../src/main/setup-wizard')
})

afterAll(() => rmSync(home, { recursive: true, force: true }))

const slot = (over: Partial<{ provider: string; model: string; baseURL: string; apiKey: string }> = {}) => ({
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  baseURL: '',
  apiKey: '',
  ...over,
})

describe('config validation before writing hermes config.yaml', () => {
  it('accepts the shapes real providers use', () => {
    expect(sw.validateSlot(slot())).toEqual([])
    expect(sw.validateSlot(slot({ model: 'anthropic/claude-opus-4' }))).toEqual([])
    expect(sw.validateSlot(slot({ model: 'gpt-4o@2024-08' }))).toEqual([])
    expect(sw.validateSlot(slot({ provider: 'custom', model: 'local-7b', baseURL: 'http://127.0.0.1:8000/v1' }))).toEqual([])
    expect(sw.validateSlot(slot({ provider: 'minimax.cn', model: 'abab6.5' }))).toEqual([])
  })

  it('rejects a newline in the model name (YAML injection into hermes config)', () => {
    const errs = sw.validateSlot(slot({ model: 'good\n  api_key: evil' }))
    expect(errs.length).toBe(1)
    expect(errs[0]).toContain('model')
  })

  it('rejects empty model / provider, uppercase provider, spaced key, bad URL', () => {
    expect(sw.validateSlot(slot({ model: '  ' })).join()).toContain('model 不能为空')
    expect(sw.validateSlot(slot({ provider: '' })).join()).toContain('provider 不能为空')
    expect(sw.validateSlot(slot({ provider: 'DeepSeek' })).join()).toContain('provider')
    expect(sw.validateSlot(slot({ apiKey: 'sk-a b' })).join()).toContain('api_key')
    expect(sw.validateSlot(slot({ provider: 'custom', baseURL: 'not a url' })).join()).toContain('base_url')
    expect(sw.validateSlot(slot({ provider: 'custom', baseURL: '' })).join()).toContain('base_url')
  })

  it('refuses to write an invalid slot — no config.yaml is created', () => {
    const res = sw.saveBrainConfig(
      slot({ model: 'planner\napi_key: leaked' }),
      slot(),
    )
    expect(res.ok).toBe(false)
    expect(res.errors?.join()).toContain('planner')
    expect(existsSync(configPath())).toBe(false)
  })

  it('writes a valid brain config and reports ok', () => {
    const res = sw.saveBrainConfig(slot({ model: 'planner-model' }), slot({ model: 'worker-model' }))
    expect(res.ok).toBe(true)
    const yaml = readFileSync(configPath(), 'utf-8')
    expect(yaml).toContain('default: planner-model')   // model.default = planner
    expect(yaml).toContain('model: worker-model')      // delegation.model = worker
    expect(yaml).toContain('provider: deepseek')
  })

  it('legacy setup:save path is guarded too', () => {
    const bad = sw.saveConfig({ provider: 'deepseek', baseURL: '', apiKey: '', model: 'x\ny: z' }, 'deepseek')
    expect(bad.ok).toBe(false)
    const ok = sw.saveConfig({ provider: 'deepseek', baseURL: '', apiKey: '', model: 'valid-model' }, 'deepseek')
    expect(ok.ok).toBe(true)
  })
})
