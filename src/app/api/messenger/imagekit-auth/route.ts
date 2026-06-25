import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getImageKit } from '@/lib/imagekit/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mint a short-lived ImageKit upload signature so the operator's browser can
 * upload an attachment directly to ImageKit, bypassing this app's serverless
 * request-body cap (~4.5 MB on Vercel). The signature only authorizes an upload
 * — it carries no read access — and is scoped to the operator's own folder.
 *
 * The private key never leaves the server; only `{ token, expire, signature }`
 * plus the public key and namespaced folder are returned.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { token, expire, signature } = getImageKit().getAuthenticationParameters()

  return NextResponse.json({
    token,
    expire,
    signature,
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    folder: `/operator-sends/${user.id}`,
  })
}
