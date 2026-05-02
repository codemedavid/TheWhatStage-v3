import type { CSSProperties } from 'react'
import type { KindRendererProps } from '../types'
import BookingPicker from './Renderer.client'
import { parseBookingConfig } from './schema'

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'B'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

function shortTimezone(tz: string): string {
  return tz.replace(/_/g, ' ')
}

function durationLabel(min: number): string {
  if (min < 60) return `${min} minutes`
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? '' : 's'}`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

export default function BookingRenderer({
  page,
  claims,
  rawToken,
  variant,
}: KindRendererProps) {
  const config = parseBookingConfig(page.config)
  const standalone = variant === 'standalone'

  const cssVars: CSSProperties = {
    ['--ws-bg' as string]: config.theme.background_color,
    ['--ws-accent' as string]: config.theme.accent_color,
    ['--ws-button-text' as string]: config.theme.button_text_color,
  }

  const card = (
    <section
      aria-label="Book your call"
      className="grid w-full overflow-hidden rounded-2xl border border-[#E8E6DE] bg-white shadow-[0_1px_2px_rgba(20,18,12,0.04),0_12px_32px_-12px_rgba(20,18,12,0.08)] md:grid-cols-[280px_1fr]"
      style={cssVars}
    >
      <aside className="flex flex-col gap-[18px] border-b border-[#E8E6DE] bg-[#F6F5F1] px-6 py-7 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold text-white"
            style={{
              background: `linear-gradient(135deg, var(--ws-accent), var(--ws-accent))`,
            }}
          >
            {initials(page.title)}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-medium text-[#1A1915]">
              {page.title}
            </span>
            <span className="text-[11.5px] text-[#9C9A90]">
              Powered by WhatStage
            </span>
          </div>
        </div>

        <h1
          className="m-0 text-[28px] font-normal leading-[1.05] tracking-[-0.01em] text-[#1A1915]"
          style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
        >
          {page.title}
        </h1>
        {page.description && (
          <p className="m-0 text-[13px] leading-[1.55] text-[#6B6960]">
            {page.description}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-[#E8E6DE] pt-1.5">
          <div className="flex items-center gap-2.5 text-[13px] text-[#3F3D36]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-[#6B6960]"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {durationLabel(config.appointment.duration_min)}
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-[#3F3D36]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-[#6B6960]"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {shortTimezone(config.appointment.timezone)}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 flex-col gap-[18px] px-6 py-7 md:px-7">
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
    </section>
  )

  if (!standalone) return card

  return (
    <main
      className="flex min-h-screen flex-col bg-[#FAFAF7] text-[#1A1915]"
      style={cssVars}
    >
      <div className="flex items-center justify-between px-7 py-5">
        <span className="inline-flex items-center gap-2.5 text-[#1A1915]">
          <span
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-[13px] font-semibold italic text-white"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              background: '#1A1915',
            }}
          >
            {initials(page.title).slice(0, 1)}
          </span>
          <span className="text-[13px] font-semibold">{page.title}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[#6B6960]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#2EA86A]" />
          Secured by WhatStage
        </span>
      </div>

      <div className="flex flex-1 items-start justify-center px-5 pb-15 pt-3">
        <div className="w-full max-w-[760px]">{card}</div>
      </div>

      <div className="flex items-center justify-center gap-3 px-7 py-4 text-[11.5px] text-[#9C9A90]">
        Powered by WhatStage
      </div>
    </main>
  )
}
