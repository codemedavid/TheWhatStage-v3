import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { releasePushDevice } from '@/lib/push'
import { supabase } from '@/lib/supabase'

export type AccountStatus = 'pending' | 'active' | 'paused'

interface Profile {
  fullName: string
  role: string
  status: AccountStatus
}

interface AuthState {
  isLoading: boolean
  session: Session | null
  userId: string | null
  email: string
  profile: Profile | null
  /** True when signed in and the account is allowed into the workspace. */
  isReady: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, role, status')
    .eq('id', userId)
    .maybeSingle<{ full_name: string | null; role: string | null; status: string | null }>()
  if (!data) return null
  const status = (['pending', 'active', 'paused'] as const).includes(data.status as AccountStatus)
    ? (data.status as AccountStatus)
    : 'active'
  return { fullName: data.full_name ?? '', role: data.role ?? 'user', status }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) setProfile(await loadProfile(data.session.user.id))
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next)
      if (next) setProfile(await loadProfile(next.user.id))
      else setProfile(null)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(() => {
    const gated = profile ? profile.status !== 'active' && profile.role !== 'superadmin' : false
    return {
      isLoading,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? '',
      profile,
      isReady: !!session && !gated,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        return error ? error.message : null
      },
      async signOut() {
        // Must run first: unregistering needs a valid bearer token, and a row
        // left behind would push this operator's messages to whoever signs in
        // on the handset next.
        await releasePushDevice()
        await supabase.auth.signOut()
      },
    }
  }, [isLoading, session, profile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
