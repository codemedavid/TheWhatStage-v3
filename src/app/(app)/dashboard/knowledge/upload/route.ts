import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData()
  const file = form.get('file')
  const docId = form.get('docId')

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  if (typeof docId !== 'string' || !/^[0-9a-f-]{36}$/i.test(docId)) {
    return NextResponse.json({ error: 'Invalid doc id' }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  // Confirm the document belongs to this user (RLS would block otherwise,
  // but we want a clean 404 over a confusing storage error).
  const { data: doc } = await supabase
    .from('knowledge_documents')
    .select('id')
    .eq('id', docId)
    .maybeSingle()
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const ext = (file.type.split('/')[1] || 'bin').replace('+xml', '')
  const path = `${user.id}/${docId}/${crypto.randomUUID()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('knowledge-images')
    .upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { data: pub } = supabase.storage
    .from('knowledge-images')
    .getPublicUrl(path)

  return NextResponse.json({ url: pub.publicUrl })
}
