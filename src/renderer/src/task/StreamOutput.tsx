import { useEffect, useRef } from 'react'

interface StreamOutputProps {
  text: string
}

export default function StreamOutput({ text }: StreamOutputProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text])

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '320px',
        maxHeight: '200px',
        background: 'rgba(0, 0, 0, 0.8)',
        borderRadius: '12px',
        padding: '12px',
        zIndex: 8,
        overflow: 'hidden'
      }}
    >
      <div
        ref={scrollRef}
        style={{
          maxHeight: '176px',
          overflowY: 'auto',
          color: 'var(--ink)',
          fontSize: '11px',
          fontFamily: '-apple-system, BlinkMacSystemFont, monospace',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {text || (
          <span style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>
            Thinking...
          </span>
        )}
      </div>
    </div>
  )
}
