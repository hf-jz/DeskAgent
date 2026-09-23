// Dashboard: big KPI numbers
export default function Dashboard({ metrics }: { metrics?: { label: string; value: string | number; unit?: string }[] }) {
  if (!metrics?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No metrics</div>
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {metrics.map((m, i) => (
        <div key={i} style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-text)' }}>{m.value}<span style={{ fontSize: 12, color: 'var(--ink-muted)', marginLeft: 3 }}>{m.unit}</span></div>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{m.label}</div>
        </div>
      ))}
    </div>
  )
}
