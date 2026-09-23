// Feed: title + link list
export default function Feed({ items }: { items?: { title: string; url: string; summary?: string }[] }) {
  if (!items?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No items</div>
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ padding: '4px 0', borderBottom: i < items.length - 1 ? '1px solid var(--bg-elev)' : 'none' }}>
          <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)', fontSize: 12, textDecoration: 'none' }}>{it.title}</a>
          {it.summary && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{it.summary.slice(0, 120)}</div>}
        </div>
      ))}
    </div>
  )
}
