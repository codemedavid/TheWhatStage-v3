import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImageKit } from '@/lib/imagekit/server'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  checkRateLimit,
  clientRateKey,
  extForImageType,
  sniffImageType,
} from '@/lib/action-pages/upload-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = ALLOWED_IMAGE_TYPES
const MAX_BYTES = MAX_UPLOAD_BYTES

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params

  // Best-effort per-IP rate limit. This route is public + unauthenticated and
  // hits our ImageKit quota, so cap scripted abuse before doing any work.
  if (!checkRateLimit(clientRateKey(req.headers, slug))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

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

  // Do not trust the client-declared file.type: sniff the magic bytes and
  // reject anything that is not a real JPEG/PNG/WebP.
  const sniffed = sniffImageType(buffer)
  if (!sniffed)
    return NextResponse.json({ error: 'unsupported image type' }, { status: 400 })

  const ext = extForImageType(sniffed)
  const fileName = `customer-${Date.now()}.${ext}`

  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/action-pages/${page.id}/customer-uploads`,
    useUniqueFileName: true,
  })

  return NextResponse.json({ url: result.url, fileId: result.fileId })
}
