import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureDefaultFolder } from '@/lib/media/default-folder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const folderId = await ensureDefaultFolder(supabase, user.id)
    return NextResponse.json({ folderId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    )
  }
}
