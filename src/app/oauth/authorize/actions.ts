'use server'

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRedirectUrl, pickAuthorizeParams, validateAuthorizeRequest } from '@/lib/oauth/authorize-request'
import { issueAuthorizationCode } from '@/lib/oauth/codes'
import { loginUrlForAuthorize } from './login-return'

// The hidden form fields carry the original authorize query, so both actions
// re-validate from scratch: a tampered form can never reach a redirect the
// client did not register.
function paramsFromForm(formData: FormData): Record<string, string | undefined> {
  const entries: Record<string, string | undefined> = {}
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string') entries[k] = v
  }
  return pickAuthorizeParams(entries)
}

async function validatedFromForm(formData: FormData) {
  const raw = paramsFromForm(formData)
  const session = await getSession()
  if (!session) redirect(loginUrlForAuthorize(raw))
  const validation = await validateAuthorizeRequest(createAdminClient(), raw)
  if (!validation.ok) {
    if (validation.kind === 'fatal') throw new Error(validation.message)
    redirect(buildRedirectUrl(validation.redirectUri, {
      error: validation.error,
      error_description: validation.description,
      state: validation.state,
    }))
  }
  return { session, validation }
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const { session, validation } = await validatedFromForm(formData)
  const { request } = validation
  const code = await issueAuthorizationCode(createAdminClient(), {
    clientId: request.clientId,
    userId: session.userId,
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
  })
  redirect(buildRedirectUrl(request.redirectUri, { code, state: request.state }))
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  const { validation } = await validatedFromForm(formData)
  redirect(buildRedirectUrl(validation.request.redirectUri, {
    error: 'access_denied',
    error_description: 'The user declined the request.',
    state: validation.request.state,
  }))
}
