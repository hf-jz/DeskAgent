// Clock: timezone or countdown
import { useState, useEffect } from 'react'

export default function Clock({ timezone, targetTs }: { timezone?: string; targetTs?: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  let text: string
  if (timezone) {
    text = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
  } else if (targetTs) {
    const d = Math.max(0, Math.floor((targetTs - now) / 1000))
    const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = d % 60
    text = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  } else {
    text = new Date(now).toLocaleTimeString()
  }
  return <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', textAlign: 'center' }}>{text}</div>
}
