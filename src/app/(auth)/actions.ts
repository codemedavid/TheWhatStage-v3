'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signUpSchema, signInSchema } from '@/lib/auth/schemas'
import { isAccountStatus, pathForBlockedStatus } from '@/lib/auth/account-status'
import { getPostAuthRedirect } from '@/lib/onboarding/post-auth-redirect'

export type AuthFormState = {
  formError?: string
  fieldErrors?: Record<string, string>
}

function flattenFieldErrors(
  err: import('zod').ZodError,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path[0]?.toString() ?? '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) }
  }

  const admin = createAdminClient()
  const { error: createErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  })

  if (createErr) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[signUpAction] supabase create error:', createErr)
    }
    if (createErr.message?.toLowerCase().includes('already')) {
      return { formError: 'An account with that email already exists.' }
    }
    return { formError: 'Could not create account. Please try again.' }
  }

  // New accounts land as 'pending' (handle_new_user trigger). They can't use
  // the app until the superadmin approves them, so skip auto sign-in and
  // onboarding init — both will happen the first time they sign in post-
  // approval (ensureOnboardingState is called defensively from save actions).
  redirect('/account-pending')
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { formError: 'Invalid email or password.' }
  }

  const userId = signInData.user?.id
  if (userId) {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('status, role')
      .eq('id', userId)
      .single()

    const status = isAccountStatus(profile?.status) ? profile.status : 'active'
    const blockedPath = profile?.role === 'superadmin' ? null : pathForBlockedStatus(status)
    if (blockedPath) {
      await supabase.auth.signOut()
      redirect(blockedPath)
    }
  }

  redirect(await getPostAuthRedirect())
}
