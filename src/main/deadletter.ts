// ── D2 #45: dead-letter ring buffer — "events nobody picked up" ──
// In-memory 200-entry FIFO. Diagnostic surface, not a ledger: no persistence,
// no clear API. Three hook sites: unhandled bridge events, IPC handler throws,
// inbox timeout sweeps.

export interface DeadLetter {
  ts: number
  kind: 'bridge-event' | 'ipc-error' | 'inbox-timeout' | 'mention' | 'cron' | 'unknown'
  summary: string
  detail?: string
}

const CAP = 200
const buf: DeadLetter[] = []

export function pushDeadLetter(kind: DeadLetter['kind'], summary: string, detail?: string): void {
  buf.push({ ts: Date.now(), kind, summary: summary.slice(0, 300), detail: detail?.slice(0, 1000) })
  if (buf.length > CAP) buf.splice(0, buf.length - CAP)
}

export function listDeadLetters(): DeadLetter[] {
  return [...buf].reverse() // newest first
}
