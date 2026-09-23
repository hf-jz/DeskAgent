// Checklist: checkbox items
export default function Checklist({ items }: { items?: { text: string; done?: boolean }[] }) {
  if (!items?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No tasks</div>
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', color: it.done ? 'var(--ink-muted)' : 'var(--ink-secondary)', fontSize: 12 }}>
          <span>{it.done ? '✅' : '⬜'}</span>
          <span style={{ textDecoration: it.done ? 'line-through' : 'none' }}>{it.text}</span>
        </div>
      ))}
    </div>
  )
}
