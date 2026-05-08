import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getImageKit } from '@/lib/imagekit/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug: id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: page } = await supabase
    .from('action_pages')
    .select('id, kind')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; kind: string }>()
  if (!page)
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (page.kind !== 'realestate' && page.kind !== 'catalog' && page.kind !== 'sales')
    return NextResponse.json({ error: 'wrong_kind' }, { status: 400 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File))
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!ALLOWED.has(file.type))
    return NextResponse.json(
      { error: 'unsupported image type — use JPEG, PNG, or WebP' },
      { status: 400 },
    )
  if (file.size > MAX_BYTES)
    return NextResponse.json(
      { error: 'image too large (max 5 MB)' },
      { status: 400 },
    )

  const imagekit = getImageKit()
  const buffer = Buffer.from(await file.arrayBuffer())
  const ext =
    file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg'
  const fileName = `gallery-${Date.now()}.${ext}`

  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/action-pages/${id}`,
    useUniqueFileName: true,
  })

  return NextResponse.json({ url: result.url, fileId: result.fileId })
}
