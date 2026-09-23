// Monitor: status indicator
const colors: Record<string, string> = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--danger)' }
export default function Monitor({ status, label }: { status?: string; label?: string }) {
  const c = colors[status || 'ok'] || 'var(--ink-muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}60` }} />
      <div>
        <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{label || status || 'Ok'}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{status}</div>
      </div>
    </div>
  )
}
