// Links: button links list
export default function Links({ links }: { links?: { label: string; url: string }[] }) {
  if (!links?.length) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No links</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{
          display: 'block', padding: '6px 10px', borderRadius: 6, fontSize: 12,
          background: 'var(--bg-elev)', color: 'var(--info)', textDecoration: 'none',
        }}>{l.label}</a>
      ))}
    </div>
  )
}
