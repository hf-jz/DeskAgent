// ── D4 #46: mentions inbox for inbound connector messages ──
// Connector-era facility: remote platforms (#27) deliver mention events here.
// Dedupe by (channel, externalId) so retries/webhook redeliveries don't
// double-notify; per-channel ring buffer of 50 (coworker ChannelBuffer).
// Duplicates and oversized payloads route to deadletter (#45 kind slot).
import { pushDeadLetter } from './deadletter'

export interface Mention {
  channel: string      // e.g. 'slack', 'discord', 'telegram'
  externalId: string   // platform-native message id (dedupe key)
  author: string
  text: string
  ts: number
}

const CAP = 50
const buffers = new Map<string, Mention[]>()  // channel → ring (newest last)
const seen = new Set<string>()                // 'channel:externalId'
const seenOrder: string[] = []                // FIFO eviction for seen set
const SEEN_CAP = 2000

/** Ingest one mention event. Returns true when newly buffered, false when
 *  dropped as a duplicate. */
export function ingestMention(m: Mention): boolean {
  const key = `${m.channel}:${m.externalId}`
  if (!m.channel || !m.externalId) {
    pushDeadLetter('mention', 'malformed mention (missing channel/id)', JSON.stringify(m).slice(0, 300))
    return false
  }
  if (seen.has(key)) return false // redelivery — silently dropped, by design

  seen.add(key)
  seenOrder.push(key)
  if (seenOrder.length > SEEN_CAP) seen.delete(seenOrder.shift()!)

  const entry: Mention = { ...m, text: m.text.slice(0, 2000), ts: m.ts || Date.now() }
  const buf = buffers.get(m.channel) ?? []
  buf.push(entry)
  if (buf.length > CAP) buf.splice(0, buf.length - CAP)
  buffers.set(m.channel, buf)
  return true
}

export function listMentions(channel?: string): Mention[] {
  const all = channel ? [channel] : [...buffers.keys()]
  return all.flatMap(c => buffers.get(c) ?? []).sort((a, b) => b.ts - a.ts)
}

export function unreadCount(): number {
  return [...buffers.values()].reduce((n, b) => n + b.length, 0)
}
