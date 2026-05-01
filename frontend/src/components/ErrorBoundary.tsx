import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback || (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 320, padding: 48, textAlign: 'center', gap: 16,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 24, fontSize: 32,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            display: 'grid', placeItems: 'center',
          }}>⚠️</div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
              Something went wrong
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text2)', maxWidth: 360, lineHeight: 1.6 }}>
              {this.props.label ? `The ${this.props.label} failed to load.` : 'This section encountered an error.'}
              {' '}The rest of the app is still working.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btnPrimary" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button className="btn btnGhost" onClick={() => window.location.reload()}>
                Reload page
              </button>
            </div>
          </div>
          {import.meta.env.DEV && (
            <details style={{ marginTop: 16, textAlign: 'left', maxWidth: 480 }}>
              <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>Error details (dev)</summary>
              <pre style={{ fontSize: 11, color: '#ef4444', marginTop: 8, padding: 12, background: 'rgba(239,68,68,0.06)', borderRadius: 8, overflow: 'auto' }}>
                {this.state.error?.message}
              </pre>
            </details>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
