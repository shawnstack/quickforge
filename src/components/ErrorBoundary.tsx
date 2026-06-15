import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    logger.error('ErrorBoundary caught an error:', error, info)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-md rounded-lg border border-border bg-card p-5 shadow-sm text-center">
            <h1 className="text-base font-semibold">{t('errorBoundaryTitle')}</h1>
            <p className="mt-2 text-sm text-muted-foreground break-all">
              {this.state.error.message || t('errorBoundaryUnexpected')}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={this.handleRetry}>
              {t('errorBoundaryTryAgain')}
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
