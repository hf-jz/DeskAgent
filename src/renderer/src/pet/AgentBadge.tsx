interface AgentBadgeProps {
  name: string
  status: string
}

export default function AgentBadge({ name, status }: AgentBadgeProps): React.JSX.Element {
  const statusColor = status === 'running' ? '#10B981' : status === 'error' ? '#EF4444' : '#6B7280'

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '4px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.7)',
        borderRadius: '10px',
        padding: '2px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        zIndex: 5,
        whiteSpace: 'nowrap'
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: statusColor,
          display: 'inline-block'
        }}
      />
      <span
        style={{
          color: 'rgba(255,255,255,0.8)',
          fontSize: '9px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontWeight: 500
        }}
      >
        {name}
      </span>
    </div>
  )
}
