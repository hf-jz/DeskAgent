// ImageBlock: simple image display
export default function ImageBlock({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No image</div>
  return <img src={src} alt={alt || ''} style={{ maxWidth: '100%', borderRadius: 6 }} />
}
