'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  changeEmailSchema,
  changePasswordSchema,
} from '@/lib/auth/account-schemas'
import type {
  AccountField,
  AccountFormState,
} from './_lib/account-form-state'

const SETTINGS_PATH = '/dashboard/settings/account'
const SESSION_EXPIRED: AccountFormState = {
  status: 'error',
  message: 'Your session expired. Please sign in again.',
}

function firstFieldError(
  err: import('zod').ZodError,
): { field?: AccountField; message: string } {
  const issue = err.issues[0]
  const field = issue?.path[0]?.toString() as AccountField | undefined
  return { field, message: issue?.message ?? 'Invalid input.' }
}

export async function changePasswordAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = changePasswordSchema.safeParse({
    current_password: formData.get('current_password'),
    new_password: formData.get('new_password'),
    confirm_password: formData.get('confirm_password'),
  })
  if (!parsed.success) {
    const { field, message } = firstFieldError(parsed.error)
    return { status: 'error', message, field }
  }

  const session = await getSession()
  if (!session) return SESSION_EXPIRED

  const supabase = await createClient()

  // The only way to confirm the user actually knows their current password is
  // to re-authenticate. This refreshes the current session cookie but leaves
  // the password unchanged.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: session.email,
    password: parsed.data.current_password,
  })
  if (reauthError) {
    return {
      status: 'error',
      message: 'Current password is incorrect.',
      field: 'current_password',
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  })
  if (updateError) {
    return {
      status: 'error',
      message: 'Could not update your password. Please try again.',
    }
  }

  revalidatePath(SETTINGS_PATH)
  return { status: 'ok', message: 'Password updated.' }
}

export async function changeEmailAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = changeEmailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    const { message } = firstFieldError(parsed.error)
    return { status: 'error', message, field: 'email' }
  }

  const session = await getSession()
  if (!session) return SESSION_EXPIRED

  if (parsed.data.email === session.email.toLowerCase()) {
    return {
      status: 'error',
      message: 'That is already your email address.',
      field: 'email',
    }
  }

  // Consistent with signup, which bypasses email confirmation via the admin
  // client (createUser({ email_confirm: true })). We update the email directly
  // and mark it confirmed rather than triggering Supabase's verification flow,
  // for which this app has no callback route.
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(session.userId, {
    email: parsed.data.email,
    email_confirm: true,
  })
  if (error) {
    return {
      status: 'error',
      message: 'Could not update your email. It may already be in use.',
      field: 'email',
    }
  }

  revalidatePath(SETTINGS_PATH)
  return {
    status: 'ok',
    message: `Email updated to ${parsed.data.email}. Use it the next time you sign in.`,
  }
}

export async function signOutEverywhereAction(): Promise<void> {
  const supabase = await createClient()
  // scope: 'global' revokes every refresh token for the user, killing sessions
  // on all other devices in addition to this one.
  await supabase.auth.signOut({ scope: 'global' })
  redirect('/login')
}
