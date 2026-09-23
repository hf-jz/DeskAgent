import { useState, useRef, useEffect, useCallback } from 'react'

interface TaskInputProps {
  onSubmit: (task: string) => void
  onCancel: () => void
}

// ponytail: inline mic capture, extract to useVoiceInput hook when reused

export default function TaskInput({ onSubmit, onCancel }: TaskInputProps): React.JSX.Element {
  const [task, setTask] = useState('')
  const [recording, setRecording] = useState(false)
  const [voicePending, setVoicePending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // mic refs — useRef avoids trap#18 (inline callbacks → infinite start/stop)
  const micRef = useRef<{
    stream: MediaStream | null
    ctx: AudioContext | null
    chunks: Int16Array[]
  }>({ stream: null, ctx: null, chunks: [] })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Start voice bridge on mount so it's warm
  useEffect(() => {
    window.deskAppAPI.voiceStart().catch(() => {})
  }, [])

  const handleSubmit = (): void => {
    const trimmed = task.trim()
    if (trimmed) {
      onSubmit(trimmed)
      setTask('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  const startRecording = useCallback(async () => {
    try {
      // Barge-in: stop any playing TTS
      window.deskAppAPI.voiceInterrupt().catch(() => {})
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      // ScriptProcessor: 1024 samples (power of 2, trap#14)
      const processor = ctx.createScriptProcessor(1024, 1, 1)
      source.connect(processor)
      processor.connect(ctx.destination)

      const r = micRef.current
      r.stream = stream
      r.ctx = ctx
      r.chunks = []

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        // -38dB RMS gate (trap#9)
        let sum = 0
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
        const rms = Math.sqrt(sum / input.length)
        if (20 * Math.log10(rms) < -38) return

        // Convert Float32 → Int16 PCM (resample to 16kHz if needed)
        const targetRate = 16000
        const ratio = ctx.sampleRate / targetRate
        const outLen = Math.floor(input.length / ratio)
        const out = new Int16Array(outLen)
        for (let i = 0; i < outLen; i++) {
          const srcIdx = Math.floor(i * ratio)
          const s = Math.max(-1, Math.min(1, input[srcIdx]))
          out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        r.chunks.push(out)
      }

      setRecording(true)
    } catch (err) {
      console.error('Mic error:', err)
    }
  }, [])

  const stopRecording = useCallback(async () => {
    const r = micRef.current
    // Disconnect
    r.stream?.getTracks().forEach((t) => t.stop())
    await r.ctx?.close()
    setRecording(false)

    // Convert accumulated PCM → base64
    let totalLen = 0
    for (const c of r.chunks) totalLen += c.length
    if (totalLen === 0) return

    const buf = new Uint8Array(totalLen * 2)
    let off = 0
    for (const c of r.chunks) {
      const bytes = new Uint8Array(c.buffer, c.byteOffset, c.byteLength)
      buf.set(bytes, off)
      off += bytes.length
    }

    // base64 encode
    let b64 = ''
    const chunk = 4096
    for (let i = 0; i < buf.length; i += chunk) {
      b64 += String.fromCharCode(...buf.subarray(i, i + chunk))
    }
    b64 = btoa(b64)

    // Reset chunks
    r.chunks = []
    r.stream = null
    r.ctx = null

    // Send to ASR
    setVoicePending(true)
    try {
      const text = await window.deskAppAPI.voiceAsr(b64)
      if (text) setTask(text)
    } catch (err) {
      console.error('ASR error:', err)
    } finally {
      setVoicePending(false)
    }
  }, [])

  const commonButtonStyle: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--ink-secondary)',
    border: '1px solid var(--ink-faint)',
    borderRadius: '8px',
    padding: '6px 14px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        borderRadius: '50%',
        zIndex: 10
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          width: '300px',
          maxWidth: '90vw',
          background: 'var(--bg-elev)',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          border: '1px solid var(--solid)'
        }}
      >
        <h3
          style={{
            color: 'var(--ink)',
            fontSize: '14px',
            fontWeight: 600,
            marginBottom: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          {voicePending ? 'Transcribing...' : 'What can I help with?'}
        </h3>
        <textarea
          ref={inputRef}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={voicePending ? 'Listening...' : 'Ask me anything...'}
          rows={3}
          style={{
            width: '100%',
            background: 'var(--bg-elev)',
            color: 'var(--ink)',
            border: '1px solid var(--line-strong)',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '13px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            resize: 'none',
            outline: 'none'
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '12px'
          }}
        >
          <button onClick={onCancel} style={commonButtonStyle}>
            Cancel
          </button>
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => { if (recording) stopRecording() }}
            style={{
              ...commonButtonStyle,
              background: recording
                ? 'linear-gradient(135deg, var(--danger), #DC2626)'
                : 'transparent',
              color: recording ? 'var(--ink)' : 'var(--ink-secondary)',
              borderColor: recording ? 'var(--danger)' : 'var(--ink-faint)',
            }}
          >
            {recording ? '🔴' : '🎤'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!task.trim()}
            style={{
              background: task.trim()
                ? 'linear-gradient(135deg, var(--accent), var(--accent-2))'
                : 'var(--solid)',
              color: task.trim() ? 'var(--ink)' : 'var(--ink-faint)',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: task.trim() ? 'pointer' : 'default',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
            }}
          >
            Send
          </button>
        </div>
        <div
          style={{
            color: 'var(--ink-faint)',
            fontSize: '10px',
            textAlign: 'center',
            marginTop: '8px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
          }}
        >
          Cmd+Enter to send · Esc to cancel
        </div>
      </div>
    </div>
  )
}
