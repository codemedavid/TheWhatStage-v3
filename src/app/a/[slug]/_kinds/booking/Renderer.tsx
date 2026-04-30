import type { KindRendererProps } from '../types'
import BookingPicker from './Renderer.client'
import { parseBookingConfig } from './schema'

export default function BookingRenderer({
  page,
  claims,
  rawToken,
}: KindRendererProps) {
  const config = parseBookingConfig(page.config)
  return (
    <div
      className="space-y-5 rounded-lg p-1"
      style={
        {
          ['--ws-bg' as string]: config.theme.background_color,
          ['--ws-accent' as string]: config.theme.accent_color,
          ['--ws-button-text' as string]: config.theme.button_text_color,
          background: 'var(--ws-bg)',
        } as React.CSSProperties
      }
    >
      <header>
        <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">Booking</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[#111827]">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-1 text-[14px] text-[#6B7280]">{page.description}</p>
        )}
      </header>
      <BookingPicker
        slug={page.slug}
        config={config}
        hidden={{
          slug: page.slug,
          p: claims?.psid ?? null,
          g: claims?.pageId ?? null,
          e: claims ? String(claims.exp) : null,
          t: rawToken ?? null,
        }}
      />
    </div>
  )
}
