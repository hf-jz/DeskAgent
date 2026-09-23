// ── Pure cron day-matching for the workspace 任务进度 gantt ──
// Day-level granularity: hour/minute fields are parsed (validated) but not
// used for the timeline. Supports *, comma lists, a-b ranges, */step — the
// syntax the templates and LLM specs use. Unparseable → matches nothing.

export interface ParsedCron {
  minutes: number[]
  hours: number[]
  dom: number[]
  month: number[]
  dow: number[]
}

export function parseCron(schedule: string): ParsedCron | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const fields: { raw: string; max: number }[] = [
    { raw: parts[0], max: 59 }, { raw: parts[1], max: 23 },
    { raw: parts[2], max: 31 }, { raw: parts[3], max: 12 },
    { raw: parts[4], max: 7 },
  ]
  const out: number[][] = []
  for (const f of fields) {
    const nums: number[] = []
    for (const tok of f.raw.split(',')) {
      if (!tok) return null
      if (tok === '*') continue // unrestricted — leave nums empty
      const step = /^\*\/(\d+)$/.exec(tok)
      if (step) {
        const n = Number(step[1])
        if (n < 1) return null
        for (let v = 0; v <= f.max; v += n) nums.push(v)
        continue
      }
      const m = /^(\d+)(?:-(\d+))?$/.exec(tok)
      if (!m) return null
      const a = Number(m[1])
      const b = m[2] ? Number(m[2]) : a
      if (b < a || b > f.max) return null
      for (let v = a; v <= b; v++) nums.push(v)
    }
    out.push([...new Set(nums)])
  }
  return { minutes: out[0], hours: out[1], dom: out[2], month: out[3], dow: out[4] }
}

/** Standard cron day-match: restricted dom/dow are OR-ed (Vixie cron rule). */
export function cronMatchesDay(parsed: ParsedCron, date: Date): boolean {
  if (parsed.month.length && !parsed.month.includes(date.getMonth() + 1)) return false
  const dom = date.getDate()
  const dow = date.getDay()
  const domHit = !parsed.dom.length || parsed.dom.includes(dom)
  const dowHit = !parsed.dow.length || parsed.dow.includes(dow) || (dow === 0 && parsed.dow.includes(7))
  if (!parsed.dom.length || !parsed.dow.length) return domHit && dowHit
  return domHit || dowHit
}

/** All days in [from, to] (inclusive, day granularity) whose schedule fires. */
export function cronDaysInRange(schedule: string, from: Date, to: Date): Date[] {
  const parsed = parseCron(schedule)
  if (!parsed) return []
  const out: Date[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cur <= end) {
    if (cronMatchesDay(parsed, cur)) out.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function fmtDay(d: Date): string { return `${d.getMonth() + 1}.${d.getDate()}` }
