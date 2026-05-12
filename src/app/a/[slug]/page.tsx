import { notFound } from 'next/navigation'
import { loadPublicActionPage } from './_lib/load'
import { ActionPageRenderer } from './_components/Renderer'
import { createAdminClient } from '@/lib/supabase/admin'

async function loadSubmissionPublicMessage(args: {
  pageId: string
  submissionId: string | null
}): Promise<string | null> {
  if (!args.submissionId) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('action_page_submissions')
    .select('data')
    .eq('id', args.submissionId)
    .eq('action_page_id', args.pageId)
    .maybeSingle<{ data: Record<string, unknown> | null }>()
  const outcomeAction = data?.data?.outcome_action
  if (!outcomeAction || typeof outcomeAction !== 'object') return null
  const msg = (outcomeAction as { public_message?: unknown }).public_message
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null
}

export default async function PublicActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const result = await loadPublicActionPage(slug, sp)
  if (!result) notFound()

  const rawToken = typeof sp.t === 'string' ? sp.t : null
  const submitted = sp.submitted === '1'
  const submissionId = typeof sp.submission === 'string' ? sp.submission : null
  const publicMessage = submitted
    ? await loadSubmissionPublicMessage({ pageId: result.page.id, submissionId })
    : null
  const isBooking = result.page.kind === 'booking' && !submitted
  const isCatalog = result.page.kind === 'catalog' && !submitted
  const isRealestate = result.page.kind === 'realestate' && !submitted
  const isSales = result.page.kind === 'sales' && !submitted

  if (isBooking || isCatalog || isRealestate || isSales) {
    return (
      <ActionPageRenderer
        page={result.page}
        claims={result.claims}
        rawToken={rawToken}
        variant="standalone"
        products={result.products ?? []}
        paymentMethods={result.paymentMethods ?? []}
        searchParams={sp}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[#F9FAFB] px-4 py-10">
      <div className="mx-auto max-w-xl rounded-xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        {submitted ? (
          <div className="text-center">
            <h1 className="text-[22px] font-semibold text-[#111827]">Thanks!</h1>
            <p className="mt-1 text-[14px] text-[#6B7280]">
              {publicMessage ??
                'Your submission has been received. You can close this tab and head back to Messenger.'}
            </p>
          </div>
        ) : (
          <ActionPageRenderer
            page={result.page}
            claims={result.claims}
            rawToken={rawToken}
            variant="standalone"
            products={result.products ?? []}
            paymentMethods={result.paymentMethods ?? []}
          />
        )}
      </div>
    </main>
  )
}
