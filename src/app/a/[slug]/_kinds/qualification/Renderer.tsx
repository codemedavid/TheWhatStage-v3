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
      <header>
        <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">
          Qualification
        </p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[#111827]">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-1 text-[14px] text-[#6B7280]">{page.description}</p>
        )}
      </header>

      <QualificationClient
        slug={page.slug}
        config={config}
        deeplink={deeplink}
      />
    </div>
  )
}
