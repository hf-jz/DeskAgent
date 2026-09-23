// Alerts: warning/notification list
const levelColors: Record<string, string> = { info: 'var(--accent-2)', warn: 'var(--warn)', error: 'var(--danger)', critical: '#dc2626' }

export default function Alerts({ alerts }: { alerts?: { level?: string; message: string; ts?: number }[] }) {
  if (!alerts?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No alerts</div>
  return (
    <div>
      {alerts.map((a, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
          borderBottom: '1px solid var(--bg-elev)', fontSize: 12, color: 'var(--ink-secondary)',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: levelColors[a.level || 'info'], flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{a.message}</span>
          {a.ts && <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{new Date(a.ts).toLocaleTimeString()}</span>}
        </div>
      ))}
    </div>
  )
}
