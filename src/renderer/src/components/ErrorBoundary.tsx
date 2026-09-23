import React from 'react'
import { t } from '../lib/i18n'

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

/**
 * Global renderer crash guard. Without this, any React error in a frameless
 * always-on-top window leaves a blank/invisible widget with no recovery path.
 * Shows a minimal fallback with a reload action instead of a white screen.
 */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(err: unknown, info: React.ErrorInfo): void {
    try {
      // console.error is auto-forwarded to the main process by the preload
      console.error('[DeskApp ErrorBoundary]', err, info.componentStack)
    } catch { /* never throw from the catcher */ }
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10,
        background: 'var(--bg-elev)', color: 'var(--ink-secondary)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', fontSize: 12,
        borderRadius: 16, padding: 20, boxSizing: 'border-box', textAlign: 'center',
      }}>
        <div style={{ fontSize: 22 }}>⚠️</div>
        <div style={{ fontWeight: 600 }}>{t('err.ui')}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-faint)', maxWidth: 280, wordBreak: 'break-word' }}>
          {this.state.message.slice(0, 200)}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 6, padding: '5px 16px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            color: 'var(--ink)', fontSize: 12, cursor: 'pointer',
          }}
        >{t('err.reload')}</button>
      </div>
    )
  }
}
