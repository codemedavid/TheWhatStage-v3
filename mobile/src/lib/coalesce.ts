import { useCallback, useEffect, useRef } from 'react'

/**
 * Collapse a burst of events into at most one action per window.
 *
 * Realtime tables like `messenger_threads` and `leads` emit a row change for
 * every inbound reply, outbound send and counter bump. Acting on each event
 * individually means a busy page keeps the screen permanently re-fetching and
 * the first paint never lands.
 *
 * The first call in a quiet period runs immediately (the UI stays snappy for a
 * single change); anything arriving inside `windowMs` is collapsed into one
 * trailing call, so a stream of N events costs 2 actions, not N.
 */
export function useCoalescedCallback(action: () => void, windowMs: number): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRun = useRef(0)
  // Kept in a ref so the returned function is stable across renders even when
  // the caller passes an inline closure. Written in an effect, never during
  // render, and only ever read from a timer or event handler.
  const latest = useRef(action)
  useEffect(() => {
    latest.current = action
  }, [action])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    [],
  )

  return useCallback(() => {
    if (timer.current) return // a trailing call is already queued
    const elapsed = Date.now() - lastRun.current
    if (elapsed >= windowMs) {
      lastRun.current = Date.now()
      latest.current()
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      lastRun.current = Date.now()
      latest.current()
    }, windowMs - elapsed)
  }, [windowMs])
}
