'use client'

import { useEffect } from 'react'

/**
 * Live status polling for pending templates. Runs a single interval that fires
 * ONLY while the tab is visible AND at least one template is pending — an idle
 * or hidden tab makes zero Graph calls. The interval restarts when the set of
 * pending ids changes and stops once nothing is pending. The caller's `refresh`
 * should poll Meta for the given ids and merge any changed rows into state;
 * pass a stable (useCallback'd) function so the interval isn't reset on every
 * unrelated render.
 */
export function useTemplatePolling(
  pendingIds: string[],
  refresh: (ids: string[]) => Promise<void>,
  intervalMs = 15000,
): { active: boolean } {
  // Stable string key for the pending set — drives effect restarts.
  const key = pendingIds.join(',')

  useEffect(() => {
    if (!key) return
    const ids = key.split(',')
    let cancelled = false
    let running = false

    const tick = async () => {
      if (cancelled || running) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      running = true
      try {
        await refresh(ids)
      } finally {
        running = false
      }
    }

    const timer = setInterval(() => { void tick() }, intervalMs)
    const onVis = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [key, intervalMs, refresh])

  return { active: pendingIds.length > 0 }
}
