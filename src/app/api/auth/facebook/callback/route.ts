import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { verifyState } from '@/lib/facebook/state'
import {
  exchangeCodeForToken,
  exchangeForLongLived,
  fetchMe,
  fetchGrantedPermissions,
  isUtilityMessagingGranted,
} from '@/lib/facebook/oauth'
import { decryptToken, encryptToken } from '@/lib/facebook/crypto'
import { subscribePageToWebhook } from '@/lib/facebook/messenger'

function settingsRedirect(params?: { error?: string; warn?: string }): NextResponse {
  const url = new URL('/dashboard/settings/facebook', process.env.NEXT_PUBLIC_APP_URL!)
  if (params?.error) url.searchParams.set('error', params.error)
  if (params?.warn) url.searchParams.set('warn', params.warn)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  const url = new URL(req.url)
  if (url.searchParams.get('error') || url.searchParams.get('error_code')) {
    return settingsRedirect({ error: 'denied' })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return settingsRedirect({ error: 'invalid_state' })
  }

  const cookieStore = await cookies()
  const cookieState = cookieStore.get('fb_oauth_state')?.value
  cookieStore.delete('fb_oauth_state')
  if (!cookieState || cookieState !== state || !verifyState(state, session.userId)) {
    return settingsRedirect({ error: 'invalid_state' })
  }

  const supabase = await createClient()
  let connectionId: string | null = null
  let utilityMessagingMissing = false

  try {
    const shortLived = await exchangeCodeForToken(code)
    const { token: longLived, expiresAt } = await exchangeForLongLived(shortLived)
    const fbUserId = await fetchMe(longLived)

    // Best-effort: surface it immediately when Meta withheld
    // pages_utility_messaging, so the user learns out-of-window templates won't
    // work now — not later when a template submit fails with code 200. A failed
    // permissions read must never block the connection itself.
    try {
      utilityMessagingMissing = !isUtilityMessagingGranted(
        await fetchGrantedPermissions(longLived),
      )
    } catch {
      utilityMessagingMissing = false
    }

    const { data, error } = await supabase
      .from('facebook_connections')
      .upsert(
        {
          user_id: session.userId,
          fb_user_id: fbUserId,
          long_lived_token: encryptToken(longLived),
          token_expires_at: expiresAt ? expiresAt.toISOString() : null,
          // Reconnecting clears any prior pause. Existing pages (and their
          // Messenger history + leads) were preserved by soft-disconnect and
          // are re-subscribed below so the bot resumes.
          disconnected_at: null,
        },
        { onConflict: 'user_id' },
      )
      .select('id')
      .single()

    if (error) throw error
    connectionId = data.id
  } catch {
    if (connectionId) {
      await supabase.from('facebook_connections').delete().eq('id', connectionId)
    }
    return settingsRedirect({ error: 'exchange_failed' })
  }

  // Resume Messenger delivery for pages that were preserved through a prior
  // soft-disconnect. New connections have no pages yet (the user picks them on
  // the settings page, which subscribes them), so this is a no-op then.
  // Best-effort: a failed re-subscribe never blocks the reconnect.
  const { data: pages } = await supabase
    .from('facebook_pages')
    .select('page_access_token')
    .eq('connection_id', connectionId)
  await Promise.allSettled(
    (pages ?? []).map(async (p) => {
      try {
        await subscribePageToWebhook(decryptToken(p.page_access_token))
      } catch (e) {
        console.error('[fb.callback] re-subscribe failed', e)
      }
    }),
  )

  return settingsRedirect(
    utilityMessagingMissing ? { warn: 'utility_messaging_missing' } : undefined,
  )
}
