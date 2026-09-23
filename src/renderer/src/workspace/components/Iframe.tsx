// Iframe: sandboxed embed
export default function Iframe({ src, title }: { src?: string; title?: string }) {
  if (!src) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No URL</div>
  return (
    <iframe src={src} title={title || 'embed'} sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height: 240, border: '1px solid var(--bg-elev)', borderRadius: 6, background: 'var(--ink)' }} />
  )
}
