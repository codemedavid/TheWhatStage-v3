// src/app/api/cron/template-status-poll/route.ts
//
// Backstop poller for pending message-template approvals. Meta's
// `message_template_status_update` webhook is documented-unreliable for
// Messenger pages, so we also poll: find every template still 'pending', group
// by resolved page, fetch each page's template list ONCE (paginated), and flip
// matched rows through the shared statusFlip helper. The open Templates page
// also live-polls; this cron is the "nobody's looking" safety net.
//
// Reuses CRON_SECRET (cron auth), matching the other cron routes.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import { resolveTargetPage, type ResolvedPage } from '@/lib/facebook/templates-page-resolver'
import { fetchAllMessengerTemplates, type MetaTemplateRow } from '@/lib/facebook/messenger-templates'
import { mapMetaStatus, buildStatusUpdate } from '@/lib/messenger-templates/statusFlip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PendingRow {
  id: string
  user_id: string
  page_id: string | null
  name: string
  language: string
  meta_status: string
  meta_template_id: string | null
}

export async function GET(req: Request): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const admin = createAdminClient()

  // Give Meta a couple of minutes after submit before polling, so we don't race
  // the synchronous create response that already set the row.
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from('messenger_message_templates')
    .select('id, user_id, page_id, name, language, meta_status, meta_template_id, submitted_at')
    .eq('meta_status', 'pending')
    .or(`submitted_at.is.null,submitted_at.lt.${cutoff}`)
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(500)

  if (error) {
    console.error('[cron.template-status-poll] query failed', error.message)
    return NextResponse.json({ checked: 0, flipped: 0, error: error.message }, { status: 200 })
  }

  const rows = (data ?? []) as PendingRow[]

  // Resolve each (user_id, page_id) once; fetch each page's template list once.
  const resolveCache = new Map<string, ResolvedPage | null>()
  const listCache = new Map<string, MetaTemplateRow[] | null>()

  // Bound work per invocation so the pass can't exceed maxDuration when pending
  // rows span many distinct pages. Rows are ordered oldest-first, so deferred
  // pages are simply picked up on the next 2-min tick (writes are idempotent).
  const MAX_PAGES_PER_RUN = 80
  let pagesFetched = 0

  let checked = 0
  let flipped = 0
  let deferred = 0

  for (const row of rows) {
    checked += 1
    try {
      const rKey = `${row.user_id}|${row.page_id ?? ''}`
      let page = resolveCache.get(rKey)
      if (page === undefined) {
        page = await resolveTargetPage(admin, row.user_id, row.page_id)
        resolveCache.set(rKey, page)
      }
      if (!page) continue

      let all = listCache.get(page.fb_page_id)
      if (all === undefined) {
        if (pagesFetched >= MAX_PAGES_PER_RUN) {
          // Page budget exhausted for this pass — defer to the next tick.
          deferred += 1
          continue
        }
        pagesFetched += 1
        try {
          all = await fetchAllMessengerTemplates({
            fbPageId: page.fb_page_id,
            pageAccessToken: decryptToken(page.page_access_token),
          })
        } catch (e) {
          console.warn('[cron.template-status-poll] page fetch failed', page.fb_page_id, (e as Error).message)
          all = null
        }
        listCache.set(page.fb_page_id, all)
      }
      if (!all) continue

      const match = all.find((t) => t.name === row.name && t.language === row.language)
      if (!match) continue

      const localStatus = mapMetaStatus(match.status)
      const statusChanged = localStatus !== row.meta_status
      const backfill = !row.meta_template_id && !!match.id
      if (!statusChanged && !backfill) continue

      await admin
        .from('messenger_message_templates')
        .update(
          buildStatusUpdate(localStatus, {
            rejectedReason: match.rejected_reason,
            metaTemplateId: match.id,
            hadMetaTemplateId: !!row.meta_template_id,
          }),
        )
        .eq('id', row.id)

      if (statusChanged) flipped += 1
    } catch (e) {
      // One bad page/token must not abort the whole pass.
      console.warn('[cron.template-status-poll] row failed', row.id, (e as Error).message)
    }
  }

  if (deferred > 0) {
    console.warn('[cron.template-status-poll] page budget hit — deferred rows to next tick', { deferred, pagesFetched })
  }
  return NextResponse.json({ checked, flipped, deferred })
}
