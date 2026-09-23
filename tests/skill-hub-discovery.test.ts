import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Fail-safe skill discovery (ax's local.Discover semantics): one unreadable or
 * dangling entry in the skills dir must skip that entry, not break every skill
 * lookup. SKILLS_DIR is fixed at import time from $HOME, so the store is
 * imported dynamically after pointing HOME at a scratch tree.
 */

let home: string
let store: typeof import('../src/main/skill-hub/store')

const canonical = (name: string) => `---
name: ${name}
version: 0.1.0
category: dev
trigger: test
description: a test skill
---

Do the thing.
`

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'deskapp-skills-'))
  process.env.HOME = home
  const skills = join(home, '.deskapp', 'skills')
  mkdirSync(join(skills, 'dev', 'good-skill'), { recursive: true })
  writeFileSync(join(skills, 'dev', 'good-skill', 'SKILL.canonical.md'), canonical('good-skill'))
  // the two landmines: a dangling symlink where a category should be, and a
  // broken link inside a real category
  symlinkSync(join(home, 'does-not-exist'), join(skills, 'dangling-category'))
  symlinkSync(join(home, 'nope.md'), join(skills, 'dev', 'broken-skill'))
  writeFileSync(join(skills, 'index.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: [
      // stale category on purpose: the index path misses, so getSkill() has to
      // fall back to scanning the tree (findSkillFile) and still find it
      { name: 'good-skill', category: 'moved-elsewhere', description: 'x', active: true },
      { name: 'broken-skill', category: 'dev', description: 'points nowhere', active: true },
    ],
  }))
  store = await import('../src/main/skill-hub/store')
})

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('skill discovery', () => {
  it('finds a healthy skill while broken entries sit next to it', () => {
    const s = store.getSkill('good-skill')
    expect(s?.name).toBe('good-skill')
    expect(s?.instructions).toBe('Do the thing.')
  })

  it('returns null for a skill whose file is a dangling symlink — no throw', () => {
    expect(() => store.getSkill('broken-skill')).not.toThrow()
    expect(store.getSkill('broken-skill')).toBeNull()
  })

  it('survives a corrupt index.json', () => {
    writeFileSync(join(home, '.deskapp', 'skills', 'index.json'), '{ not json')
    expect(store.listSkills()).toEqual([])
    // restore for the assertions above this file's ordering
    writeFileSync(join(home, '.deskapp', 'skills', 'index.json'), JSON.stringify({
      version: 1, updatedAt: new Date().toISOString(),
      skills: [{ name: 'good-skill', category: 'dev', description: 'x', active: true }],
    }))
    expect(store.getSkill('good-skill')?.name).toBe('good-skill')
  })
})
