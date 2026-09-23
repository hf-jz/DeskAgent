// Chart: CSS bar chart (no Chart.js)
const COLORS = ['var(--accent)', 'var(--accent-text)', 'var(--warn)', 'var(--ok)', 'var(--danger)', 'var(--accent-2)', '#ec4899', '#f97316']

export default function Chart({ data }: { data?: { label: string; value: number }[] }) {
  if (!data?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No data</div>
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, paddingBottom: 20 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginBottom: 3 }}>{d.value}</div>
          <div style={{ width: '100%', maxWidth: 40, height: `${(d.value / max) * 70}px`, background: COLORS[i % COLORS.length], borderRadius: 3 }} />
          <div style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 4, textAlign: 'center' }}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}
