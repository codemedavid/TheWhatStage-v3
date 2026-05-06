import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getImageKit } from '@/lib/imagekit/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const productId = String(form.get('productId') ?? '').trim()
  const file = form.get('file')

  if (!productId)
    return NextResponse.json({ error: 'productId required' }, { status: 400 })
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

  const { data: product } = await supabase
    .from('business_items')
    .select('id')
    .eq('id', productId)
    .eq('user_id', user.id)
    .eq('kind', 'product')
    .maybeSingle()
  if (!product)
    return NextResponse.json({ error: 'product not found' }, { status: 404 })

  const imagekit = getImageKit()
  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg'
  const fileName = `cover-${Date.now()}.${ext}`

  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/products/${productId}`,
    useUniqueFileName: false,
  })

  // Replace primary media record
  await supabase
    .from('business_item_media')
    .delete()
    .eq('item_id', productId)
    .eq('user_id', user.id)
    .eq('is_primary', true)

  await supabase.from('business_item_media').insert({
    user_id: user.id,
    item_id: productId,
    kind: 'image',
    storage_path: result.fileId,
    alt_text: null,
    position: 0,
    is_primary: true,
  })

  await supabase
    .from('business_items')
    .update({ cover_image_url: result.url })
    .eq('id', productId)
    .eq('user_id', user.id)

  return NextResponse.json({ url: result.url, fileId: result.fileId })
}
