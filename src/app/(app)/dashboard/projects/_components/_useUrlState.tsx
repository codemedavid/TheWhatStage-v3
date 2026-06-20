'use client'
import {
  createContext,
  useCallback,
  useContext,
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

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k)
        else next.set(k, v)
      }
      start(() => router.replace(`${pathname}?${next.toString()}`))
    },
    [router, pathname, sp, start],
  )

  return { sp, set, isPending }
}
