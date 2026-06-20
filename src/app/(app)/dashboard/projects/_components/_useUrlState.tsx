'use client'
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useTransition,
  type ReactNode,
} from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

type NavCtxValue = { isPending: boolean; start: (cb: () => void) => void } | null
const NavContext = createContext<NavCtxValue>(null)

export function ProjectsNavProvider({ children }: { children: ReactNode }) {
  const [isPending, start] = useTransition()
  return (
    <NavContext.Provider value={{ isPending, start }}>
      {children}
    </NavContext.Provider>
  )
}

export function useNavPending(): boolean {
  return useContext(NavContext)?.isPending ?? false
}

export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const ctx = useContext(NavContext)
  const [localPending, localStart] = useTransition()
  const isPending = ctx?.isPending ?? localPending
  const start = ctx?.start ?? localStart

  // Read the latest search params through a ref so `set` keeps a STABLE identity
  // across navigations. If `set` depended on `sp` directly it would change on
  // every URL update, re-running any effect that lists it as a dependency (e.g.
  // the Toolbar's debounced search push) — which fires another navigation, and
  // the board refreshes in an endless loop when a filter is switched.
  const spRef = useRef(sp)
  spRef.current = sp

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(spRef.current.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k)
        else next.set(k, v)
      }
      next.delete('page')
      const qs = next.toString()
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname))
    },
    [router, pathname, start],
  )

  return { sp, set, isPending }
}
