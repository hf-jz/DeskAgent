interface SpeechBubbleProps {
  text: string | null
}

/**
 * Speech bubble floating above the pet's head, inside the pet window.
 * Display-only: the pet window ignores mouse events, so the bubble never
 * blocks desktop clicks. PetApp controls mount/unmount via `text`.
 */
export default function SpeechBubble({ text }: SpeechBubbleProps): React.JSX.Element | null {
  if (!text) return null
  return (
    <div style={{
      position: 'absolute', top: 6, left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255,255,255,0.97)', color: '#1F2937',
      borderRadius: 14, padding: '8px 14px',
      fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      fontFamily: '-apple-system, "PingFang SC", sans-serif',
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      animation: 'petBubbleIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
      zIndex: 10, pointerEvents: 'none',
    }}>
      {text}
      <div style={{
        position: 'absolute', left: '50%', bottom: -5,
        width: 10, height: 10,
        background: 'rgba(255,255,255,0.97)',
        transform: 'translateX(-50%) rotate(45deg)',
        borderRadius: 2,
      }} />
      <style>{`
        @keyframes petBubbleIn {
          0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.7); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
