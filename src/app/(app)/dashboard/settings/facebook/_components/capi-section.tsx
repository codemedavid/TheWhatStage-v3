import { CapiPageForm } from './capi-page-form'
import { CapiRecentEvents } from './capi-recent-events'

type LogRow = Parameters<typeof CapiRecentEvents>[0]['rows'][number]

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiSection({
  pages,
  recentRows,
}: {
  pages: Page[]
  recentRows: LogRow[]
}) {
  if (pages.length === 0) return null
  const enabledCount = pages.filter((p) => p.capi_enabled).length

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] p-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-[#111827]">
              Conversions API
            </h2>
            <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-medium text-[#6B7280]">
              Business Messaging
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-[#6B7280]">
            Forward conversion events to Meta when leads complete actions on your pages. Improves
            ad optimization for Click-to-Messenger campaigns.{' '}
            <a
              href="https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[#047857] hover:underline"
            >
              Learn more →
            </a>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#374151]">
          {enabledCount}/{pages.length} enabled
        </span>
      </header>

      <div className="space-y-3 p-6">
        {pages.map((p) => (
          <CapiPageForm key={p.id} page={p} />
        ))}
      </div>

      <div className="border-t border-[#E5E7EB] p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#111827]">Recent events</h3>
          <span className="text-[11px] text-[#9CA3AF]">last 20</span>
        </div>
        <CapiRecentEvents rows={recentRows} />
      </div>
    </section>
  )
}
