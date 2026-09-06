import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRedirectUrl, pickAuthorizeParams, validateAuthorizeRequest } from '@/lib/oauth/authorize-request'
import { ConsentCard } from './_components/consent-card'
import { ErrorCard } from './_components/error-card'
import { loginUrlForAuthorize } from './login-return'

export const dynamic = 'force-dynamic'

interface AuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * OAuth 2.1 authorization endpoint. An MCP client sends the operator here;
 * we make sure they are signed in to WhatStage, show what the app will be
 * able to do, and hand back a one-time code on approval.
 */
export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const raw = pickAuthorizeParams(await searchParams)
  const validation = await validateAuthorizeRequest(createAdminClient(), raw)
  if (!validation.ok && validation.kind === 'fatal') {
    return <ErrorCard message={validation.message} />
  }
  if (!validation.ok) {
    redirect(buildRedirectUrl(validation.redirectUri, {
      error: validation.error,
      error_description: validation.description,
      state: validation.state,
    }))
  }

  const session = await getSession()
  if (!session) redirect(loginUrlForAuthorize(raw))

  return (
    <ConsentCard
      clientName={validation.client.clientName ?? 'An MCP client'}
      redirectHost={new URL(validation.request.redirectUri).host}
      scopes={validation.request.scopes}
      userEmail={session.email}
      raw={raw}
    />
  )
}
