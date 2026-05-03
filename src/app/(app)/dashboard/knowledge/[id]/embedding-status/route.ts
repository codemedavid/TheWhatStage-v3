import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Lightweight JSON endpoint the editor polls so users see the dot flip from
// "Indexing…" → "Ready" without a full page refresh.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [docRes, jobRes] = await Promise.all([
    supabase
      .from('knowledge_documents')
      .select('embedding_status, embedded_at, version, has_unsaved_changes')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('knowledge_embedding_jobs')
      .select('status, attempts, last_error, scheduled_at, started_at, finished_at')
      .eq('document_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (docRes.error || !docRes.data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return NextResponse.json({
    embedding_status: docRes.data.embedding_status,
    embedded_at: docRes.data.embedded_at,
    version: docRes.data.version,
    has_unsaved_changes: docRes.data.has_unsaved_changes,
    job: jobRes.data ?? null,
  })
}
