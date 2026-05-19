import { z } from 'zod'

export const ACCOUNT_STATUSES = ['pending', 'active', 'paused'] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const zAccountStatus = z.enum(ACCOUNT_STATUSES)

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && (ACCOUNT_STATUSES as readonly string[]).includes(value)
}

export function pathForBlockedStatus(status: AccountStatus): '/account-pending' | '/account-paused' | null {
  if (status === 'pending') return '/account-pending'
  if (status === 'paused') return '/account-paused'
  return null
}
