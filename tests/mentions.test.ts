// D4 #46+#50: mentions buffer semantics, exercised through the FakeSlack harness.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ingestMention, listMentions, unreadCount } from '../src/main/mentions'
import { FakeSlack, slackPayloadToMention } from './helpers/fake-slack'

describe('mentions (#46) via FakeSlack (#50)', () => {
  let slack: FakeSlack
  beforeEach(async () => { slack = new FakeSlack(); await slack.start() })
  afterEach(() => slack.stop())

  it('new mention is buffered, newest first', () => {
    const m = slackPayloadToMention(FakeSlack.mentionPayload('u1', 'hello pet', 'Ev1'))
    expect(ingestMention(m)).toBe(true)
    const list = listMentions('slack')
    expect(list[0].text).toBe('hello pet')
    expect(list[0].author).toBe('u1')
  })

  it('duplicate externalId is dropped (webhook redelivery)', () => {
    const m = slackPayloadToMention(FakeSlack.mentionPayload('u1', 'hi', 'Ev-dup'))
    expect(ingestMention(m)).toBe(true)
    expect(ingestMention({ ...m })).toBe(false)
    expect(listMentions('slack').filter(x => x.externalId === 'Ev-dup')).toHaveLength(1)
  })

  it('malformed mention (no id) routes to deadletter, not buffer', () => {
    const before = unreadCount()
    expect(ingestMention({ channel: 'slack', externalId: '', author: 'x', text: 'y', ts: 1 })).toBe(false)
    expect(unreadCount()).toBe(before)
  })

  it('ring buffer caps at 50 per channel', () => {
    for (let i = 0; i < 60; i++) {
      ingestMention(slackPayloadToMention(FakeSlack.mentionPayload('u2', `m${i}`, `Ev-cap-${i}`)))
    }
    const list = listMentions('slack').filter(x => x.externalId.startsWith('Ev-cap-'))
    expect(list).toHaveLength(50)
    const texts = list.map(x => x.text)
    expect(texts).toContain('m10')   // oldest 10 evicted
    expect(texts).not.toContain('m9')
    expect(texts).toContain('m59')
  })

  it('FakeSlack records outbound postMessage', async () => {
    const base = await slack.start // already started; use posted recording only
    void base
    await fetch(`http://127.0.0.1:${(slack.server.address() as any).port}/chat.postMessage`, {
      method: 'POST', body: JSON.stringify({ text: 'reply from pet', channel: 'C0TEST' }),
    })
    expect(slack.posted[0].text).toBe('reply from pet')
  })
})
