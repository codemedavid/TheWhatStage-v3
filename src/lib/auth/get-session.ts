import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { isAccountStatus, type AccountStatus } from './account-status'

export type Role = 'user' | 'admin' | 'superadmin'

export type SessionContext = {
  userId: string
  email: string
  fullName: string
  role: Role
  status: AccountStatus
}

export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, status')
    .eq('id', user.id)
    .single()

  const role: Role =
    (profile?.role as Role | undefined) ??
    (user.app_metadata?.role as Role | undefined) ??
    'user'

  const status: AccountStatus = isAccountStatus(profile?.status) ? profile.status : 'active'

  // Superadmin is never gated — they own the kill switch.
  if (status !== 'active' && role !== 'superadmin') return null

  return {
    userId: user.id,
    email: user.email ?? '',
    fullName: profile?.full_name ?? '',
    role,
    status,
  }
})
