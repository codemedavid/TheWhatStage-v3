'use client'

import type { CSSProperties } from 'react'
import type { SalesConfig } from '@/app/a/[slug]/_kinds/sales/schema'

const CURRENCY_SYMBOL: Record<string, string> = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  SGD: 'S$',
  JPY: '¥',
  CAD: 'C$',
}

function fmtPrice(currency: string, amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return ''
  const sym = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  return `${sym}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}`
}

function periodLabel(period: SalesConfig['price']['period']): string {
  if (period === 'monthly') return 'Per month'
  if (period === 'yearly') return 'Per year'
  return 'One-time payment'
}

function initials(text: string): string {
  const t = text.trim()
  if (!t) return 'S'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function SalesStudioPreview({
  title,
  config,
  operatorName,
  selectedBlock,
}: {
  title: string
  config: SalesConfig
  operatorName?: string
  selectedBlock: string
}) {
  const accent = config.theme.accent_color || '#a04e3e'
  const buttonText = config.theme.button_text_color || '#fbf2e2'
  const paper = config.theme.background_color || '#f5ecdf'
  const heroImg = [...config.gallery].sort((a, b) => a.position - b.position).find((g) => g.primary) ?? config.gallery[0]
  const headline = config.product.headline || title || 'Untitled product'
  const tagline = config.product.tagline
  const description = config.product.description
  const priceAmount = config.price.amount
  const compareAt = config.price.compare_at_amount
  const showSave = compareAt != null && priceAmount != null && compareAt > priceAmount
  const wordmark = operatorName?.trim() || 'WhatStage'

  const cssVars: CSSProperties = {
    ['--accent' as string]: accent,
  }

  const outlineStyle = (id: string): CSSProperties =>
    selectedBlock === id
      ? { outline: `2px solid ${accent}`, outlineOffset: -2 }
      : {}

  return (
    <div
      style={{
        ...cssVars,
        width: 360,
        background: paper,
        color: '#231a14',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 8px 28px rgba(60,50,30,.10)',
        border: '1px solid #e6e2d6',
        fontSize: 13,
        fontFamily: "'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* HERO */}
      <div data-block="hero" style={outlineStyle('hero')}>
        <div
          style={{
            width: '100%',
            aspectRatio: '16/10',
            background: heroImg?.url
              ? `url(${heroImg.url}) center/cover no-repeat`
              : `linear-gradient(135deg, ${accent}, #6e4a37)`,
            position: 'relative',
          }}
        >
          {!heroImg?.url && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(circle at 30% 50%, rgba(255,235,205,.25), transparent 70%)',
              }}
            />
          )}
          {config.gallery.length > 1 && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 4 }}>
              {config.gallery.slice(0, 8).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === 0 ? '#fff' : 'rgba(255,255,255,.4)',
                  }}
                />
              ))}
            </div>
          )}
          {config.gallery.length > 1 && (
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'rgba(0,0,0,.55)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 10,
                backdropFilter: 'blur(4px)',
              }}
            >
              1 / {config.gallery.length}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '14px 18px 0' }}>
        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, opacity: 0.75 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: accent,
              color: buttonText,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {initials(wordmark).slice(0, 1)}
          </div>
          <span style={{ fontSize: 11, fontWeight: 600 }}>{wordmark}</span>
        </div>

        {/* HEADLINE */}
        <div data-block="headline" style={{ padding: '2px 0', ...outlineStyle('headline') }}>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: -0.5,
              lineHeight: 1.15,
              fontFamily: "'Instrument Serif', Georgia, serif",
            }}
          >
            {headline}
          </h1>
          {tagline && (
            <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, opacity: 0.7 }}>{tagline}</p>
          )}
        </div>

        {/* PRICING */}
        <div
          data-block="pricing"
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 10,
            background: '#fff',
            border: '1px solid rgba(0,0,0,.06)',
            ...outlineStyle('pricing'),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: accent }}>
              {config.price.display_label
                ? config.price.display_label
                : fmtPrice(config.price.currency, priceAmount) || 'Set price'}
            </span>
            {showSave && (
              <span style={{ fontSize: 13, color: '#8c8675', textDecoration: 'line-through' }}>
                {fmtPrice(config.price.currency, compareAt)}
              </span>
            )}
            {showSave && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#2f5a35',
                  background: '#e4ede0',
                  padding: '2px 6px',
                  borderRadius: 3,
                }}
              >
                Save {fmtPrice(config.price.currency, (compareAt ?? 0) - (priceAmount ?? 0))}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#8c8675', marginTop: 2 }}>{periodLabel(config.price.period)}</div>

          <div data-block="cta" style={{ ...outlineStyle('cta') }}>
            <button
              type="button"
              style={{
                marginTop: 12,
                width: '100%',
                padding: '11px 14px',
                borderRadius: 8,
                background: accent,
                color: buttonText,
                fontWeight: 600,
                fontSize: 13.5,
                border: 0,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {config.cta.primary_label || 'Get it now'} →
            </button>
            {config.cta.secondary_label && (
              <button
                type="button"
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '8px 14px',
                  borderRadius: 6,
                  background: 'transparent',
                  color: '#5a4737',
                  fontWeight: 500,
                  fontSize: 12,
                  border: 0,
                  cursor: 'pointer',
                }}
              >
                {config.cta.secondary_label}
              </button>
            )}
          </div>
        </div>

        {/* DESCRIPTION */}
        {(description.trim() || selectedBlock === 'description') && (
          <div
            data-block="description"
            style={{
              marginTop: 14,
              padding: '2px 0',
              ...outlineStyle('description'),
            }}
          >
            {description.trim() ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: '#3a2e22',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {description}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#a89679', fontStyle: 'italic' }}>
                Add a longer pitch — what buyers get, who it&apos;s for, why it works.
              </p>
            )}
          </div>
        )}

        {/* SOCIAL PROOF */}
        {config.social_proof.length > 0 && (
          <div
            data-block="socialProof"
            style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(3, config.social_proof.length)}, 1fr)`,
              gap: 0,
              background: '#fff',
              borderRadius: 8,
              padding: '10px 8px',
              border: '1px solid rgba(0,0,0,.05)',
              ...outlineStyle('socialProof'),
            }}
          >
            {config.social_proof.slice(0, 6).map((s, i) => (
              <div
                key={s.id}
                style={{
                  textAlign: 'center',
                  borderRight: i < Math.min(3, config.social_proof.length) - 1 ? '1px solid rgba(0,0,0,.06)' : 'none',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: accent }}>
                  {s.stat_value || '—'}
                </div>
                <div style={{ fontSize: 10, color: '#8c8675', marginTop: 2 }}>{s.stat_label}</div>
              </div>
            ))}
          </div>
        )}

        {/* FEATURES */}
        {config.features.length > 0 && (
          <div data-block="features" style={{ marginTop: 14, padding: '4px 0', ...outlineStyle('features') }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#8c8675',
                marginBottom: 8,
              }}
            >
              What&apos;s included
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {config.features.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{f.icon || '✨'}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#231a14' }}>{f.title || 'Feature'}</div>
                    {f.body && <div style={{ fontSize: 11.5, color: '#5a4737', lineHeight: 1.4 }}>{f.body}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BENEFITS */}
        {config.benefits.length > 0 && (
          <div data-block="benefits" style={{ marginTop: 14, padding: '4px 0', ...outlineStyle('benefits') }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#8c8675',
                marginBottom: 8,
              }}
            >
              You get
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {config.benefits.map((b) => (
                <li key={b.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#3f3329' }}>
                  <span style={{ color: '#5a8c5e', fontWeight: 700, marginTop: 1 }}>✓</span>
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* TESTIMONIALS */}
        {config.testimonials.length > 0 && (
          <div data-block="testimonials" style={{ marginTop: 14, padding: '4px 0', ...outlineStyle('testimonials') }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#8c8675',
                marginBottom: 8,
              }}
            >
              From past customers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {config.testimonials.map((t) => (
                <div
                  key={t.id}
                  style={{
                    background: '#fff',
                    borderRadius: 8,
                    padding: '10px 12px',
                    border: '1px solid rgba(0,0,0,.05)',
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      color: '#231a14',
                      fontStyle: 'italic',
                      fontFamily: "'Instrument Serif', Georgia, serif",
                    }}
                  >
                    &ldquo;{t.quote || 'A quote'}&rdquo;
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    {t.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.avatar_url}
                        alt=""
                        style={{ width: 20, height: 20, borderRadius: 10, objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: 20, height: 20, borderRadius: 10, background: '#cdb89a' }} />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{t.author || 'Anonymous'}</span>
                    {t.role && <span style={{ fontSize: 10.5, color: '#8c8675' }}>· {t.role}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GUARANTEE */}
        {config.guarantee.enabled && (
          <div
            data-block="guarantee"
            style={{
              marginTop: 14,
              padding: '10px 12px',
              background: 'rgba(160,78,62,0.08)',
              border: '1px solid rgba(160,78,62,0.18)',
              borderRadius: 8,
              ...outlineStyle('guarantee'),
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 2 }}>
              ✓ {config.guarantee.title || 'Guarantee'}
            </div>
            {config.guarantee.body && (
              <div style={{ fontSize: 11.5, color: '#5a4737', lineHeight: 1.4 }}>{config.guarantee.body}</div>
            )}
          </div>
        )}

        {/* FAQS */}
        {config.faqs.length > 0 && (
          <div data-block="faqs" style={{ marginTop: 14, padding: '4px 0 14px', ...outlineStyle('faqs') }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: '#8c8675',
                marginBottom: 8,
              }}
            >
              Questions
            </div>
            <div>
              {config.faqs.map((f, i) => (
                <div
                  key={f.id}
                  style={{
                    borderBottom: i < config.faqs.length - 1 ? '1px solid rgba(0,0,0,.06)' : 'none',
                    padding: '8px 0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ marginTop: 3, flexShrink: 0, color: '#8c8675', fontSize: 11 }}>▾</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.question || 'Question'}</div>
                      {i === 0 && f.answer && (
                        <div style={{ fontSize: 11.5, color: '#5a4737', marginTop: 3, lineHeight: 1.4 }}>{f.answer}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DELIVERY */}
        {config.delivery.notes && (
          <div data-block="delivery" style={{ marginTop: 4, paddingBottom: 14, ...outlineStyle('delivery') }}>
            <div style={{ fontSize: 10.5, color: '#8c8675' }}>{config.delivery.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}
