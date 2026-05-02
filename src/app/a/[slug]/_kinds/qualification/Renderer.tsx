import type { KindRendererProps } from '../types'
import { parseQualificationConfig } from './schema'
import { QualificationClient } from './Renderer.client'

export default function QualificationRenderer({
  page,
  claims,
  rawToken,
}: KindRendererProps) {
  const config = parseQualificationConfig(page.config ?? {})
  const deeplink =
    claims && rawToken
      ? { p: claims.psid, g: claims.pageId, e: String(claims.exp), t: rawToken }
      : null

  return (
    <div
      className="space-y-5"
      style={{ backgroundColor: config.theme.background_color }}
    >
      {page.description && (
        <header>
          <p className="mt-1 text-[14px] text-[#6B7280]">{page.description}</p>
        </header>
      )}

      <QualificationClient
        slug={page.slug}
        config={config}
        deeplink={deeplink}
      />
    </div>
  )
}
