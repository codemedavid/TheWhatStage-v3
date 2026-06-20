'use client'
import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Push searchParams patches via router.replace inside a transition. `set` is
 * only called from event handlers here, so it can depend on the latest params
 * directly (no stable-identity ref dance needed).
 */
export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [isPending, start] = useTransition()

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key)
        else next.set(key, value)
      }
      const qs = next.toString()
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname))
    },
    [router, pathname, sp],
  )

  return { set, isPending }
}
