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
        <div className="errorBoundaryFallback">
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h3>Something went wrong</h3>
          <p style={{ maxWidth: 320, margin: '0 auto 16px' }}>
            {this.props.label ? `The ${this.props.label} failed to load.` : 'This section encountered an error.'} The rest of the app is still working.
          </p>
          <button
            className="btn btnPrimary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
