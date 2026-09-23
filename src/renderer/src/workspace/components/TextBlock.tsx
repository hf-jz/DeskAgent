// TextBlock: plain text or markdown
export default function TextBlock({ text, markdown }: { text?: string; markdown?: string }) {
  const content = markdown || text || ''
  if (!content) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No content</div>
  // ponytail: simple newline split, full MD rendering if needed
  const lines = content.split('\n')
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
      {lines.map((line, i) => <div key={i}>{line || '\u00A0'}</div>)}
    </div>
  )
}
