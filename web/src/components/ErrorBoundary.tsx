import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="empty" style={{ padding: '80px 20px', textAlign: 'center' }}>
          <span className="mark" style={{ color: 'var(--cinnabar)', fontSize: '48px', display: 'block', marginBottom: '16px' }}>⚠️</span>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: '20px', fontWeight: 900 }}>页面载入出错</h2>
          <p style={{ fontSize: '13px', color: 'var(--ink-soft)', margin: '12px 0 24px' }}>
            {this.state.error?.message || '未知渲染错误'}
          </p>
          <button
            className="btn primary small"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
          >
            重新载入
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
