// Tiny inline SVG charts for the creation workspace element panel (phase 3).
// ponytail: bar/line only, hand-rolled SVG; swap for lieflat-charts when the
// element panel needs real charting (axes, tooltips, interactions).
export type ChartType = 'bar' | 'line'

export function parseChart(content: string): { type: ChartType; rows: [string, number][] } {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const type: ChartType = lines[0] === 'line' ? 'line' : 'bar'
  const rows: [string, number][] = lines.slice(1)
    .map(l => { const m = l.split(/[,，\t]/); return [String(m[0] || '').trim(), Number(m[1] ?? m[0])] as [string, number] })
    .filter(r => r[0] && !isNaN(r[1]))
  return { type, rows }
}

export function chartSvg(content: string): string {
  const { type, rows } = parseChart(content)
  if (!rows.length) return '<div style="color:rgba(255,255,255,.5);font-size:14px">输入数据: label,值 每行一个</div>'
  const W = 600, H = 300, PAD = 42
  const max = Math.max(...rows.map(r => r[1]), 1)
  const bw = (W - PAD * 2) / rows.length
  const val = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
  let body: string
  if (type === 'line') {
    const pts = rows.map((r, i) => `${(PAD + i * bw + bw / 2).toFixed(1)},${val(r[1]).toFixed(1)}`).join(' ')
    const dots = rows.map((r, i) => `<circle cx="${(PAD + i * bw + bw / 2).toFixed(1)}" cy="${val(r[1]).toFixed(1)}" r="5" fill="#34d399"><title>${r[0]}: ${r[1]}</title></circle>`).join('')
    body = `<polyline points="${pts}" fill="none" stroke="#34d399" stroke-width="3"/>${dots}`
  } else {
    body = rows.map((r, i) => {
      const h = Math.max((r[1] / max) * (H - PAD * 2), 2)
      return `<rect x="${(PAD + i * bw + bw * 0.15).toFixed(1)}" y="${(H - PAD - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="#34d399" rx="3"><title>${r[0]}: ${r[1]}</title></rect>`
    }).join('')
  }
  const labels = rows.map((r, i) => `<text x="${(PAD + i * bw + bw / 2).toFixed(1)}" y="${H - 14}" font-size="11" fill="rgba(255,255,255,.5)" text-anchor="middle">${r[0]}</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${body}${labels}</svg>`
}
