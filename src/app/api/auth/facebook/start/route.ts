import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/get-session'
import { signState } from '@/lib/facebook/state'
import { buildAuthUrl } from '@/lib/facebook/oauth'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  const state = signState(session.userId)
  const cookieStore = await cookies()
  cookieStore.set('fb_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(buildAuthUrl(state))
}
