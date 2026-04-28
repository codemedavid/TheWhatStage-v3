'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, useCallback } from 'react'

export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [, start] = useTransition()

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k)
        else next.set(k, v)
      }
      next.delete('page')
      start(() => router.replace(`${pathname}?${next.toString()}`))
    },
    [router, pathname, sp],
  )

  return { sp, set }
}
