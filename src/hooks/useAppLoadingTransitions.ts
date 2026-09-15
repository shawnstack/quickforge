import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { scheduleAfterPaint } from '@/lib/schedule-after-paint'
import { logger } from '@/lib/logger'
import { t } from '@/lib/i18n'
import type { useTaskToasts } from './useTaskToasts'

const STARTUP_SPLASH_MIN_DURATION_MS = 1350
const STARTUP_SPLASH_EXIT_DURATION_MS = 280
const CONVERSATION_TRANSITION_DURATION_MS = 280

export function useAppLoadingState() {
  const sessionTransitionTokenRef = useRef(0)
  const pendingSessionLoadCancelRef = useRef<(() => void) | undefined>(undefined)
  const [startupSplashDone, setStartupSplashDone] = useState(false)
  const [startupSplashExited, setStartupSplashExited] = useState(false)
  const [visibleLoadingSessionId, setVisibleLoadingSessionId] = useState<string>()
  const visibleLoadingSessionIdRef = useRef<string | undefined>(undefined)
  const [renderedLoadingSessionId, setRenderedLoadingSessionId] = useState<string>()
  return { sessionTransitionTokenRef, pendingSessionLoadCancelRef, startupSplashDone, setStartupSplashDone, startupSplashExited, setStartupSplashExited, visibleLoadingSessionId, setVisibleLoadingSessionId, visibleLoadingSessionIdRef, renderedLoadingSessionId, setRenderedLoadingSessionId }
}

type LoadingState = ReturnType<typeof useAppLoadingState>

// Separate phase hooks preserve effect ordering around AgentManager and bootstrap.
export function useAppStartupMinimum({ setStartupSplashDone }: Pick<LoadingState, 'setStartupSplashDone'>) {
  useEffect(() => {
    const timer = window.setTimeout(() => setStartupSplashDone(true), STARTUP_SPLASH_MIN_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [setStartupSplashDone])
}

export function useAppLoadingEffects({ loadingSessionId, pendingSessionLoadCancelRef, sessionTransitionTokenRef, setRenderedLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId, renderedLoadingSessionId, visibleLoadingSessionId }: LoadingState & { loadingSessionId: string | undefined }) {
  useEffect(() => {
    if (!loadingSessionId || visibleLoadingSessionIdRef.current === loadingSessionId) return undefined
    const timer = window.setTimeout(() => {
      if (visibleLoadingSessionIdRef.current === loadingSessionId) return
      pendingSessionLoadCancelRef.current?.()
      pendingSessionLoadCancelRef.current = undefined
      sessionTransitionTokenRef.current += 1
      setRenderedLoadingSessionId(undefined)
      visibleLoadingSessionIdRef.current = loadingSessionId
      setVisibleLoadingSessionId(loadingSessionId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadingSessionId, pendingSessionLoadCancelRef, sessionTransitionTokenRef, setRenderedLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId])

  useEffect(() => {
    const visibleSessionId = visibleLoadingSessionIdRef.current
    if (!visibleSessionId || renderedLoadingSessionId !== visibleSessionId) return undefined

    const fadeTimer = window.setTimeout(() => {
      if (visibleLoadingSessionIdRef.current !== visibleSessionId) return
      visibleLoadingSessionIdRef.current = undefined
      setVisibleLoadingSessionId(undefined)
    }, CONVERSATION_TRANSITION_DURATION_MS)
    return () => window.clearTimeout(fadeTimer)
  }, [loadingSessionId, renderedLoadingSessionId, visibleLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId])
}

type TransitionOptions = LoadingState & {
  currentSessionIdRef: RefObject<string | undefined>
  addToast: ReturnType<typeof useTaskToasts>['addToast']
}

export function useAppLoadingTransitions({ currentSessionIdRef, addToast, pendingSessionLoadCancelRef, sessionTransitionTokenRef, setRenderedLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId }: TransitionOptions) {
  const beginSessionTransition = useCallback((sessionId: string) => {
    if (!sessionId || sessionId === currentSessionIdRef.current) return undefined
    pendingSessionLoadCancelRef.current?.()
    pendingSessionLoadCancelRef.current = undefined
    const token = sessionTransitionTokenRef.current + 1
    sessionTransitionTokenRef.current = token
    setRenderedLoadingSessionId(undefined)
    visibleLoadingSessionIdRef.current = sessionId
    setVisibleLoadingSessionId(sessionId)
    return token
  }, [currentSessionIdRef, pendingSessionLoadCancelRef, sessionTransitionTokenRef, setRenderedLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId])

  const cancelSessionTransition = useCallback((sessionId: string, token?: number) => {
    if (token !== undefined && sessionTransitionTokenRef.current !== token) return
    if (visibleLoadingSessionIdRef.current !== sessionId) return
    pendingSessionLoadCancelRef.current?.()
    pendingSessionLoadCancelRef.current = undefined
    sessionTransitionTokenRef.current += 1
    visibleLoadingSessionIdRef.current = undefined
    setRenderedLoadingSessionId(undefined)
    setVisibleLoadingSessionId(undefined)
  }, [pendingSessionLoadCancelRef, sessionTransitionTokenRef, setRenderedLoadingSessionId, visibleLoadingSessionIdRef, setVisibleLoadingSessionId])

  const handleSessionInitialRenderReady = useCallback((sessionId: string) => {
    if (visibleLoadingSessionIdRef.current !== sessionId) return
    pendingSessionLoadCancelRef.current = undefined
    setRenderedLoadingSessionId(sessionId)
  }, [pendingSessionLoadCancelRef, visibleLoadingSessionIdRef, setRenderedLoadingSessionId])

  const handleSessionInitialRenderError = useCallback((sessionId: string, error: unknown) => {
    logger.error('Failed to render conversation:', error)
    cancelSessionTransition(sessionId)
    addToast({
      sessionId,
      title: t('conversationLoadFailed'),
      status: 'error',
    })
  }, [addToast, cancelSessionTransition])

  const scheduleSessionLoad = useCallback((sessionId: string, load: () => Promise<boolean>) => {
    const token = beginSessionTransition(sessionId)
    if (token === undefined) {
      pendingSessionLoadCancelRef.current?.()
      pendingSessionLoadCancelRef.current = undefined
      sessionTransitionTokenRef.current += 1
      void load()
      return
    }
    pendingSessionLoadCancelRef.current = scheduleAfterPaint(() => {
      pendingSessionLoadCancelRef.current = undefined
      if (sessionTransitionTokenRef.current !== token || visibleLoadingSessionIdRef.current !== sessionId) return
      void load().then((loaded) => {
        if (!loaded) cancelSessionTransition(sessionId, token)
      })
    })
  }, [beginSessionTransition, cancelSessionTransition, pendingSessionLoadCancelRef, sessionTransitionTokenRef, visibleLoadingSessionIdRef])

  useEffect(() => () => {
    pendingSessionLoadCancelRef.current?.()
  }, [pendingSessionLoadCancelRef])
  return { beginSessionTransition, cancelSessionTransition, handleSessionInitialRenderReady, handleSessionInitialRenderError, scheduleSessionLoad }
}

export function useAppStartupExit({ startupReady, setStartupSplashExited }: Pick<LoadingState, 'setStartupSplashExited'> & { startupReady: boolean }) {
  useEffect(() => {
    if (!startupReady) return undefined
    const timer = window.setTimeout(() => setStartupSplashExited(true), STARTUP_SPLASH_EXIT_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [startupReady, setStartupSplashExited])
}
