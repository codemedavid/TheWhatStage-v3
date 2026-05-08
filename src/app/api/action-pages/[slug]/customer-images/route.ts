import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImageKit } from '@/lib/imagekit/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const admin = createAdminClient()
  const { data: page } = await admin
    .from('action_pages')
    .select('id, status')
    .eq('slug', slug)
    .maybeSingle<{ id: string; status: string }>()
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

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
  const fileName = `customer-${Date.now()}.${ext}`

  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/action-pages/${page.id}/customer-uploads`,
    useUniqueFileName: true,
  })

  return NextResponse.json({ url: result.url, fileId: result.fileId })
}
