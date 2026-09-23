// ── D4 #50: FakeSlack — hermetic stand-in for Slack's Web API + Events API ──
// Stdlib http only (no express). Two directions:
//   inbound  → server.emitMention(payload) scripts an Events-API-style JSON
//              body, exactly what a #27 connector webhook would receive
//   outbound ← POST /chat.postMessage is recorded (assert what a connector sent)
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

export interface SlackEventPayload {
  event_id: string
  event: { channel: string; user: string; text: string; ts: string }
}

export class FakeSlack {
  server: Server
  posted: { text: string; channel?: string }[] = []

  constructor() {
    this.server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat.postMessage') {
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try { this.posted.push(JSON.parse(body)) } catch { this.posted.push({ text: body }) }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        })
      } else {
        res.writeHead(404); res.end()
      }
    })
  }

  async start(): Promise<string> {
    await new Promise<void>(r => this.server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stop(): Promise<void> { return new Promise(r => this.server.close(() => r())) }

  /** Script an incoming mention in Events API shape. */
  static mentionPayload(user: string, text: string, id: string): SlackEventPayload {
    return { event_id: id, event: { channel: 'C0TEST', user, text, ts: String(Date.now() / 1000) } }
  }
}

/** Map a Slack Events payload to the deskapp Mention shape (#46 ingest). */
export function slackPayloadToMention(p: SlackEventPayload) {
  return {
    channel: 'slack',
    externalId: p.event_id,
    author: p.event.user,
    text: p.event.text,
    ts: Math.round(parseFloat(p.event.ts) * 1000),
  }
}
