import { describe, it, expect } from 'vitest'
import {
  validateSpec, specUnknownFields, SPEC_SCHEMA_VERSION, SPEC_KNOWN_FIELDS,
} from '../src/shared/gen-ui-types'

const good = { id: 'w1', title: 'Blocks', kind: 'dashboard', props: { metric: 'x' } }

describe('window spec validation', () => {
  it('accepts a well-formed spec and stamps the schema version', () => {
    const v = validateSpec(good)
    expect('error' in v).toBe(false)
    if ('error' in v) return
    expect(v.schemaVersion).toBe(SPEC_SCHEMA_VERSION)
    expect(v).toMatchObject({ id: 'w1', title: 'Blocks', kind: 'dashboard' })
  })

  it('preserves an existing schemaVersion', () => {
    const v = validateSpec({ ...good, schemaVersion: 0 })
    if ('error' in v) throw new Error(v.error)
    expect(v.schemaVersion).toBe(0)
  })

  it('reports unknown fields (the list the LLM path logs)', () => {
    expect(specUnknownFields({ ...good, metric: 'x', refreshSeconds: 60 })).toEqual(['metric', 'refreshSeconds'])
    expect(specUnknownFields(good)).toEqual([])
    expect(SPEC_KNOWN_FIELDS).toContain('schemaVersion')
  })

  it('lenient mode drops unknown fields (LLM output must not break writes)', () => {
    const v = validateSpec({ ...good, description: 'invented by the model' })
    expect('error' in v).toBe(false)
    if ('error' in v) return
    expect(v).not.toHaveProperty('description')
    expect(v.id).toBe('w1')
  })

  it('strict mode rejects unknown fields with the allowed set in the message', () => {
    const v = validateSpec({ ...good, baseurl: 'typo' }, { strict: true })
    expect('error' in v).toBe(true)
    if (!('error' in v)) return
    expect(v.error).toContain('baseurl')
    expect(v.error).toContain('schemaVersion')
  })

  it('keeps the required-field checks', () => {
    expect(validateSpec(null)).toEqual({ error: 'spec must be an object' })
    expect(validateSpec({ title: 't', kind: 'dashboard' })).toEqual({ error: 'spec.id required (string)' })
    expect(validateSpec({ id: 'a', title: 't', kind: 'nope' })).toEqual({ error: 'unknown kind: nope' })
    expect(validateSpec({ ...good, cron: { schedule: '* * * * *' } })).toEqual({ error: 'cron.schedule and cron.prompt required (string)' })
  })

  it('normalizes cron.standingGrants and props defaults', () => {
    const v = validateSpec({ id: 'a', title: 't', kind: 'feed', cron: { schedule: '0 9 * * *', prompt: 'p' } })
    if ('error' in v) throw new Error(v.error)
    expect(v.cron).toEqual({ schedule: '0 9 * * *', prompt: 'p', standingGrants: [] })
    expect(v.props).toEqual({})
  })
})
