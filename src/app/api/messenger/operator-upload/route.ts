import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getImageKit } from '@/lib/imagekit/server'
import type { MessengerAttachmentType } from '@/lib/facebook/messenger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 25 MB — comfortably under Meta's attachment ceiling.
const MAX_BYTES = 25 * 1024 * 1024

// MIME → Messenger attachment type. The allowlist is the contract: anything not
// here is rejected so we never upload (or try to send) an unsupported type.
const MIME_TO_TYPE: Record<string, MessengerAttachmentType> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'application/pdf': 'file',
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 25 MB limit' }, { status: 400 })
  }

  const attachmentType = MIME_TO_TYPE[file.type]
  if (!attachmentType) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}` },
      { status: 400 },
    )
  }

  // Upload to ImageKit — it returns a permanent public URL Meta can fetch
  // directly, so operator sends need no signed-URL round trip. Namespaced per
  // user; ImageKit appends a unique suffix to avoid collisions.
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const result = await getImageKit().upload({
      file: buffer,
      fileName: safeName || 'upload',
      folder: `/operator-sends/${user.id}`,
      useUniqueFileName: true,
    })
    return NextResponse.json({
      url: result.url,
      fileId: result.fileId,
      attachmentType,
      name: file.name.slice(0, 200),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
