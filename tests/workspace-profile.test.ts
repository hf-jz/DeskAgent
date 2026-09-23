import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  initVfs, getWorkspaceDir, readWorkspaceProfile, writeWorkspaceProfile,
  workspaceRepoStatus, ensureWorkspaceScaffold, repoDir,
} from '../src/main/vfs'
import { buildProfileBlock } from '../src/main/agents/context'

let root: string
let ws: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deskapp-wsprofile-'))
  ws = initVfs(root)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const remote = { repo: 'https://github.com/example/demo-repo.git', branch: 'main' }
const local = { repo: '/tmp/somewhere/local-thing' }

describe('workspace profile', () => {
  it('is absent until written', () => {
    expect(readWorkspaceProfile()).toBeNull()
    expect(getWorkspaceDir()).toBe(join(root, 'workspace'))
  })

  it('round-trips a profile and stamps the schema version', () => {
    writeWorkspaceProfile({ name: 'quant', goal: 'A股研究', repos: [remote, local] })
    const p = readWorkspaceProfile()
    expect(p?.schemaVersion).toBe(1)
    expect(p?.goal).toBe('A股研究')
    expect(p?.repos?.length).toBe(2)
    expect(existsSync(join(ws, '.deskapp', 'workspace.json'))).toBe(true)
  })

  it('derives dir names from the URL, honours an explicit dir', () => {
    expect(repoDir(remote)).toBe('demo-repo')
    expect(repoDir(local)).toBe('local-thing')
    expect(repoDir({ repo: 'https://x/y/z.git', dir: 'custom' })).toBe('custom')
  })

  it('reports remote repos as missing until they are actually cloned', () => {
    let st = workspaceRepoStatus(readWorkspaceProfile())
    expect(st.map((s) => s.present)).toEqual([false, false])

    // scaffold creates the empty dir — that must NOT count as present
    mkdirSync(join(ws, 'demo-repo'), { recursive: true })
    st = workspaceRepoStatus(readWorkspaceProfile())
    expect(st[0].present).toBe(false)

    // a real clone does
    mkdirSync(join(ws, 'demo-repo', '.git'), { recursive: true })
    st = workspaceRepoStatus(readWorkspaceProfile())
    expect(st[0].present).toBe(true)
  })

  it('scaffolds once, then is a no-op (marker)', () => {
    rmSync(join(ws, '.deskapp', 'initialized-v1'), { force: true })
    rmSync(join(ws, 'local-thing'), { recursive: true, force: true })

    const first = ensureWorkspaceScaffold(readWorkspaceProfile())
    expect(first.skipped).toBe(false)
    expect(first.created).toContain('local-thing')
    expect(existsSync(join(ws, '.deskapp', 'initialized-v1'))).toBe(true)

    const second = ensureWorkspaceScaffold(readWorkspaceProfile())
    expect(second.skipped).toBe(true)
    expect(second.created).toEqual([])
  })

  it('tolerates a corrupt or absent profile (never throws)', () => {
    writeFileSync(join(ws, '.deskapp', 'workspace.json'), '{ not json')
    expect(readWorkspaceProfile()).toBeNull()
    expect(workspaceRepoStatus(null)).toEqual([])
    expect(ensureWorkspaceScaffold(null)).toEqual({ created: [], skipped: true })
    writeWorkspaceProfile({ name: 'quant', goal: 'A股研究', repos: [remote, local] })
  })

  it('drops junk repo entries instead of failing the whole profile', () => {
    writeWorkspaceProfile({ repos: [{ repo: 'https://ok/keep' }, { nope: 1 } as any, 'str' as any] })
    expect(readWorkspaceProfile()?.repos?.map((r) => r.repo)).toEqual(['https://ok/keep'])
  })
})

describe('profile block (what the agent actually sees)', () => {
  const profile = { name: 'quant', goal: 'A股研究', repos: [remote, local] }

  it('is empty without a profile — no noise in the prompt', () => {
    expect(buildProfileBlock(null, [])).toBe('')
  })

  it('names the environment, the goal, and each repo with its state', () => {
    const block = buildProfileBlock(profile, workspaceRepoStatus(profile))
    expect(block).toContain('名称: quant')
    expect(block).toContain('目标: A股研究')
    expect(block).toContain('demo-repo ✓ 已存在')
    expect(block).toContain('local-thing')
    expect(block.split('\n')[0]).toBe('工作区用途:')
  })

  it('tells the agent to prepare missing repos, and stays quiet when none are', () => {
    const status = workspaceRepoStatus(profile)
    const withMissing = buildProfileBlock(profile, status.map((s) => ({ ...s, present: false })))
    expect(withMissing).toContain('缺失的仓库需要先准备好再开始工作')
    const allPresent = buildProfileBlock(profile, status.map((s) => ({ ...s, present: true })))
    expect(allPresent).not.toContain('缺失的仓库')
  })
})
