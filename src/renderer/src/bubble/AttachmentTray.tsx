import type { Attachment } from './hooks/useAttachments'

/** P1-B1 #11: horizontal chip row above the composer; rejected chips are red and auto-dismiss. */
export default function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  const fmtSize = (n: number): string => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 2px' }}>
      {items.map(a => (
        <div key={a.id} title={a.rejected || a.name} style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
          padding: '3px 8px', borderRadius: 6, maxWidth: 180,
          background: a.rejected ? 'var(--danger-soft)' : 'var(--line)',
          border: `1px solid ${a.rejected ? 'rgba(239,68,68,0.4)' : 'var(--solid)'}`,
          color: a.rejected ? 'var(--danger-text)' : 'var(--ink-secondary)',
        }}>
          <span>{a.file.type.startsWith('image/') ? '🖼' : '📄'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ color: 'var(--ink-faint)' }}>{a.rejected || fmtSize(a.size)}</span>
          <span onClick={() => onRemove(a.id)} style={{ cursor: 'pointer', color: 'var(--ink-muted)' }}>✕</span>
        </div>
      ))}
    </div>
  )
}
