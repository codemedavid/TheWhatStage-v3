import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const POLL_INTERVAL_MS = 800
const MAX_POLL_DURATION_MS = 110_000

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params

  const supabase = await createClient()
  const claims = await supabase.auth.getClaims()
  let userId: string | undefined = claims.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Verify ownership upfront.
  const { data: campaign } = await admin
    .from('agent_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string }>()

  if (!campaign) {
    return Response.json({ error: 'campaign not found' }, { status: 404 })
  }

  const enc = new TextEncoder()
  const startedAt = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch { /* closed */ }
      }

      const TERMINAL = new Set(['completed', 'cancelled', 'failed'])

      while (Date.now() - startedAt < MAX_POLL_DURATION_MS) {
        const { data } = await admin
          .from('agent_campaigns')
          .select('status, total, sent, failed, skipped')
          .eq('id', campaignId)
          .single<{ status: string; total: number; sent: number; failed: number; skipped: number }>()

        if (data) {
          send('progress', data)
          if (TERMINAL.has(data.status)) break
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}

// Cancel a campaign mid-run.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params

  const supabase = await createClient()
  const claims = await supabase.auth.getClaims()
  let userId: string | undefined = claims.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { error } = await admin
    .from('agent_campaigns')
    .update({ status: 'cancelled' })
    .eq('id', campaignId)
    .eq('user_id', userId)
    .in('status', ['sending', 'dispatching'])

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
