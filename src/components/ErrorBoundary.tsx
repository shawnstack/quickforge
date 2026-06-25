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

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-md rounded-lg border border-border bg-background p-5 text-center">
            <h1 className="text-base font-medium">{t('errorBoundaryTitle')}</h1>
            <p className="mt-2 text-sm text-muted-foreground break-all">
              {this.state.error.message || t('errorBoundaryUnexpected')}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={this.handleRetry}>
                {t('errorBoundaryTryAgain')}
              </Button>
              <Button variant="default" size="sm" onClick={this.handleReload}>
                {t('reloadPage')}
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
