import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ACTION_PAGE_KINDS, isActionPageKind } from '@/lib/action-pages/kinds'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const kindsParam = url.searchParams.get('kinds')
  const requestedKinds = kindsParam
    ? kindsParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) => isActionPageKind(s))
    : [...ACTION_PAGE_KINDS]

  const excludeId = url.searchParams.get('exclude') ?? null

  let query = supabase
    .from('action_pages')
    .select('id, title, slug, kind, status, updated_at')
    .eq('user_id', user.id)
    .in('kind', requestedKinds)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    pages: (data ?? []).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      slug: p.slug as string,
      kind: p.kind as string,
      status: p.status as string,
    })),
  })
}
