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
  return (
    <section className="space-y-4 border-t pt-6 mt-6">
      <header>
        <h2 className="text-lg font-semibold">Conversions API (Business Messaging)</h2>
        <p className="text-sm text-muted-foreground">
          Send conversion events to Meta when leads complete actions on your pages.
          Improves ad optimization for Click-to-Messenger campaigns.{' '}
          <a
            href="https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Learn more
          </a>
          .
        </p>
      </header>
      <div className="space-y-3">
        {pages.map((p) => (
          <CapiPageForm key={p.id} page={p} />
        ))}
      </div>
      <div className="space-y-2 pt-4 border-t">
        <h3 className="text-sm font-semibold">Recent events (last 20)</h3>
        <CapiRecentEvents rows={recentRows} />
      </div>
    </section>
  )
}
