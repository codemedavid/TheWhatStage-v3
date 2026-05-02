import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type Role = 'user' | 'admin' | 'superadmin'

export type SessionContext = {
  userId: string
  email: string
  fullName: string
  role: Role
}

export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  const role: Role =
    (profile?.role as Role | undefined) ??
    (user.app_metadata?.role as Role | undefined) ??
    'user'

  return {
    userId: user.id,
    email: user.email ?? '',
    fullName: profile?.full_name ?? '',
    role,
  }
})
