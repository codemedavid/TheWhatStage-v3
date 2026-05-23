import { CapiPageForm } from './capi-page-form'

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiSection({ pages }: { pages: Page[] }) {
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
    </section>
  )
}
