// ── Real thinking-block boundaries for the reasoning timeline ──
//
// The bridge marks where a thinking block ends (frame 'reasoning_end', emitted
// before the first text delta and before every tool call). Those markers travel
// to the renderer as history entries, so the timeline can split on real
// boundaries instead of regex-guessing them (ReasoningTimeline.splitIntoSteps).
//
// Pure module — used by BubbleApp, unit-tested without a DOM.

export interface ReasoningHistoryEntry {
  kind: string
  content: string
}

/**
 * Thinking blocks in order. Returns an empty array when the turn carries no
 * boundary markers at all (older sessions / older bridges) — callers then keep
 * the legacy regex splitter instead of rendering one giant thought.
 */
export function reasoningSegments(history: readonly ReasoningHistoryEntry[]): string[] {
  const out: string[] = []
  let cur = ''
  let sawMarker = false
  for (const h of history) {
    if (h.kind === 'reasoning') {
      cur += h.content
    } else if (h.kind === 'reasoning_end') {
      sawMarker = true
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    }
  }
  // trailing block that never closed (still streaming, or aborted mid-thought)
  if (sawMarker && cur.trim()) out.push(cur.trim())
  return sawMarker ? out : []
}
