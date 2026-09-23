import { useState, useEffect, useRef } from 'react'

interface ChatMsg {
  id: string
  kind: string
  content: string
  name?: string
  args?: string
}

interface SessionData {
  messages: ChatMsg[]
  timestamp: number
}

interface UseSessionReturn {
  messages: ChatMsg[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>
  sessionLoaded: React.MutableRefObject<boolean>
  showWelcome: boolean
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>
  sidRef: React.MutableRefObject<string>
  exportSession: () => void
  importSession: (file: File) => void
}

/**
 * Manages session persistence: load, auto-save, restore from settings,
 * and export/import. All state is returned to the calling component.
 */
export function useSession(): UseSessionReturn {
  // sessionStorage = window-lifetime sid: hide/show the same bubble resumes
  // the conversation; closing the window destroys it → next open is fresh.
  // Old conversations stay reachable in the session navigator.
  const SID_KEY = 'deskapp-bubble-sid'
  function resolveSid(): string {
    try {
      const stored = sessionStorage.getItem(SID_KEY)
      if (stored) return stored
    } catch { /* ignore */ }
    const sid = 'bubble-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    try { sessionStorage.setItem(SID_KEY, sid) } catch { /* ignore */ }
    return sid
  }

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [showWelcome, setShowWelcome] = useState(false)
  const sessionLoaded = useRef(false)
  // Persist session ID to localStorage so re-opening a bubble resumes the
  // same conversation instead of starting fresh every time.
  const sidRef = useRef(resolveSid())

  // Load session on mount (a pending Settings>Sessions restore wins over the fresh sid)
  useEffect(() => {
    const pending = window.deskAppAPI.takeRestore?.()
    if (pending) sidRef.current = pending
    window.deskAppAPI.loadSession(sidRef.current).then((data) => {      if (data && Array.isArray(data.messages) && data.messages.length > 0) {
        try {
          setMessages(data.messages.map((m: any) => ({ ...m, id: m.id || ('r-' + Date.now()) })))
          sessionLoaded.current = true
        } catch { /* ignore parse errors */ }
      } else {
        // Check for restore-session from Sessions tab
        const restored = localStorage.getItem('deskapp-restore-session')
        if (restored) {
          try {
            const d = JSON.parse(restored)
            if (Array.isArray(d.messages)) {
              setMessages(d.messages.map((m: any) => ({ ...m, id: m.id || ('r-' + Date.now()) })))
              sessionLoaded.current = true
            }
          } catch { /* ignore */ }
          localStorage.removeItem('deskapp-restore-session')
        }
        if (!sessionLoaded.current) setShowWelcome(true)
      }
    }).catch(() => { setShowWelcome(true) })
  }, [])

  // Auto-save on messages change
  useEffect(() => {
    if (!sessionLoaded.current && messages.length > 0) sessionLoaded.current = true
    if (sessionLoaded.current && messages.length > 0) {
      window.deskAppAPI.saveSession(sidRef.current, { messages, timestamp: Date.now() })
    }
  }, [messages])

  const exportSession = () => {
    const blob = new Blob([JSON.stringify({ messages, timestamp: Date.now() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deskapp-session-${sidRef.current}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importSession = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (Array.isArray(data.messages)) {
          setMessages(data.messages.map((m: any) => ({ ...m, id: m.id || ('r-' + Date.now()) })))
          sessionLoaded.current = true
        }
      } catch { /* ignore invalid JSON */ }
    }
    reader.readAsText(file)
  }

  return {
    messages, setMessages,
    sessionLoaded, showWelcome, setShowWelcome,
    sidRef, exportSession, importSession,
  }
}
