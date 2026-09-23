// Counter: single big number + trend arrow
const arrows: Record<string, string> = { up: '📈', down: '📉', flat: '📊' }
export default function Counter({ value, label, trend }: { value?: number | string; label?: string; trend?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-text)' }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
        {trend ? `${arrows[trend] || ''} ` : ''}{label || ''}
      </div>
    </div>
  )
}
