import { notFound } from 'next/navigation'
import { loadPublicActionPage } from './_lib/load'
import { ActionPageRenderer } from './_components/Renderer'

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
  const isBooking = result.page.kind === 'booking' && !submitted

  if (isBooking) {
    return (
      <ActionPageRenderer
        page={result.page}
        claims={result.claims}
        rawToken={rawToken}
        variant="standalone"
        products={result.products ?? []}
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
              Your submission has been received. You can close this tab and head
              back to Messenger.
            </p>
          </div>
        ) : (
          <ActionPageRenderer
            page={result.page}
            claims={result.claims}
            rawToken={rawToken}
            variant="standalone"
            products={result.products ?? []}
          />
        )}
      </div>
    </main>
  )
}
