import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { enqueueEmbedJob } from '@/lib/rag'
import { processSourceInline } from '@/lib/rag/process-now'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import { MAX_FILES_PER_UPLOAD } from '@/lib/media/upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(MAX_FILES_PER_UPLOAD),
})

interface PendingRow {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
  version: number
}

async function objectExists(supabase: Awaited<ReturnType<typeof createClient>>, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const prefix = path.slice(0, slash)
  const fileName = path.slice(slash + 1)
  const { data } = await supabase.storage.from(MEDIA_ASSETS_BUCKET).list(prefix, { search: fileName, limit: 5 })
  return (data ?? []).some((o) => o.name === fileName)
}

// Publishes rows created by /api/media/upload-intent once the browser has
// finished the direct-to-storage upload. Rows whose object never arrived are
// deleted so abandoned uploads do not linger as hidden assets.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { data: rows, error } = await supabase
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, version')
    .eq('user_id', user.id)
    .eq('is_archived', true)
    .in('id', parsed.data.assetIds)
    .returns<PendingRow[]>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const published: PendingRow[] = []
  const missing: string[] = []
  for (const row of rows ?? []) {
    if (row.storage_path === 'pending' || !(await objectExists(supabase, row.storage_path))) {
      missing.push(row.id)
      continue
    }
    const { error: updateErr } = await supabase
      .from('media_assets')
      .update({ is_archived: false, embedding_status: 'stale' })
      .eq('id', row.id)
    if (updateErr) {
      console.error('[media.upload-complete] publish failed', row.id, updateErr.message)
      continue
    }
    await enqueueEmbedJob(supabase, { kind: 'media_asset', sourceId: row.id, userId: user.id, sourceVersion: row.version })
    published.push(row)
  }

  if (missing.length) await supabase.from('media_assets').delete().in('id', missing)

  if (published.length) {
    after(async () => {
      for (const row of published) {
        try {
          await processSourceInline({ kind: 'media_asset', sourceId: row.id })
        } catch (e) {
          console.error('[media.upload-complete] inline embed failed', e)
        }
      }
    })
  }

  if (published.length === 0) {
    return NextResponse.json({ error: 'Upload did not finish — please try again' }, { status: 400 })
  }
  return NextResponse.json({
    ok: true,
    assets: published.map((r) => ({ id: r.id, name: r.name, slug: r.slug, storage_path: r.storage_path, mime_type: r.mime_type })),
    failed: missing,
  })
}
