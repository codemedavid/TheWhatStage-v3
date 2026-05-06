'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { KindRendererProps } from '../types'
import type { PublicProductCard } from '@/lib/business/public-dto'
import './catalog.css'

interface Category {
  id: string
  name: string
  product_ids: string[]
}

interface CatalogConfig {
  theme?: { accent_color?: string }
  categories?: Category[]
}

const ALL_TAB = '__all__'

const S = {
  serif: 'var(--font-instrument-serif)',
  mono: 'var(--font-geist-mono)',
  page: '#FBF9F4',
  surface: '#FFFFFF',
  surface2: '#F6F5F1',
  border: '#E8E6DE',
  borderStrong: '#D9D6CC',
  ink: '#1A1915',
  ink2: '#3F3D36',
  ink3: '#6B6960',
  ink4: '#9C9A90',
  accent: '#1F7A4D',
  accentInk: '#0F4A30',
  shadowSm: '0 1px 2px rgba(20,17,11,0.04)',
  shadowLg: '0 10px 36px rgba(20,17,11,0.12)',
}

export default function CatalogRenderer({
  page,
  rawToken,
  claims,
  products = [],
}: KindRendererProps) {
  const config = (page.config ?? {}) as CatalogConfig
  const accent = config.theme?.accent_color ?? S.accent
  const categories = (config.categories ?? []).filter((c) => c.product_ids.length > 0)
  const hasTabs = categories.length > 0

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB)
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [previewProduct, setPreviewProduct] = useState<PublicProductCard | null>(null)
  const [pulse, setPulse] = useState(0)

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  )

  const visibleProducts = useMemo(() => {
    let list = products
    if (hasTabs && activeTab !== ALL_TAB) {
      const cat = categories.find((c) => c.id === activeTab)
      if (cat) list = list.filter((p) => cat.product_ids.includes(p.id))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.summary ?? '').toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [products, hasTabs, activeTab, categories, search])

  const cartLines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([id, quantity]) => ({
          id,
          quantity,
          product: productMap.get(id),
        }))
        .filter((l) => l.product),
    [quantities, productMap],
  )

  const items = useMemo(
    () => cartLines.map(({ id, quantity }) => ({ id, quantity })),
    [cartLines],
  )
  const count = cartLines.reduce((sum, l) => sum + l.quantity, 0)

  const currency = cartLines[0]?.product?.currency ?? 'USD'
  const subtotal = cartLines.reduce(
    (sum, l) => sum + (l.product?.price_amount ?? 0) * l.quantity,
    0,
  )
  const subtotalLabel = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(subtotal)
    } catch {
      return `${subtotal.toFixed(2)} ${currency}`
    }
  }, [subtotal, currency])

  useEffect(() => {
    if (cartOpen || previewProduct) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [cartOpen, previewProduct])

  const setQty = (id: string, n: number) => {
    setQuantities((curr) => {
      const next = Math.max(0, Math.min(999, n))
      const copy = { ...curr }
      if (next === 0) delete copy[id]
      else copy[id] = next
      return copy
    })
    setPulse((p) => p + 1)
  }

  const tabCount = (catId: string) => {
    if (catId === ALL_TAB) return products.length
    const cat = categories.find((c) => c.id === catId)
    return cat ? cat.product_ids.length : 0
  }

  const accentVar = { '--shop-accent': accent } as CSSProperties

  return (
    <div className="shop-wrap" style={accentVar}>
      {/* Top bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          borderBottom: `1px solid ${S.border}`,
          background: 'rgba(251,249,244,0.85)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="shop-eyebrow" style={{ marginBottom: 2 }}>
              Shop
            </div>
            <h1
              style={{
                fontFamily: S.serif,
                fontSize: 'clamp(20px, 2.6vw, 26px)',
                fontWeight: 400,
                letterSpacing: '-0.015em',
                margin: 0,
                color: S.ink,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {page.title || 'Store'}
            </h1>
          </div>

          <div className="shop-hide-mobile" style={{ flex: 1, maxWidth: 320 }}>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="shop-btn-primary"
            style={{ position: 'relative' }}
          >
            <CartIcon />
            <span className="shop-hide-mobile" style={{ display: 'inline' }}>
              Cart
            </span>
            {count > 0 ? (
              <span
                key={pulse}
                className="shop-badge-pop"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 999,
                  background: 'white',
                  color: S.ink,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: S.mono,
                }}
              >
                {count}
              </span>
            ) : null}
          </button>
        </div>

        <div
          className="shop-show-mobile"
          style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 12px' }}
        >
          <SearchInput value={search} onChange={setSearch} />
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 120px' }}>
        {page.description ? (
          <section
            style={{
              background: `linear-gradient(135deg, ${S.surface} 0%, ${S.surface2} 100%)`,
              border: `1px solid ${S.border}`,
              borderRadius: 18,
              padding: '24px 28px',
              marginBottom: 28,
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              flexWrap: 'wrap',
              boxShadow: S.shadowSm,
            }}
          >
            <div style={{ flex: 1, minWidth: 260 }}>
              <div
                className="shop-eyebrow"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(31,122,77,0.08)',
                  color: S.accentInk,
                  padding: '5px 10px',
                  borderRadius: 999,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: accent,
                    boxShadow: '0 0 0 3px rgba(31,122,77,0.18)',
                  }}
                />
                Featured collection
              </div>
              <p
                style={{
                  margin: '10px 0 0',
                  fontSize: 14.5,
                  color: S.ink2,
                  lineHeight: 1.55,
                  maxWidth: 620,
                }}
              >
                {page.description}
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 18,
                alignItems: 'baseline',
                fontFamily: S.mono,
                color: S.ink3,
                fontSize: 12,
              }}
            >
              <span>
                <strong
                  style={{ color: S.ink, fontSize: 16, fontFamily: S.serif, fontWeight: 400 }}
                >
                  {products.length}
                </strong>{' '}
                items
              </span>
              {hasTabs ? (
                <span>
                  <strong
                    style={{ color: S.ink, fontSize: 16, fontFamily: S.serif, fontWeight: 400 }}
                  >
                    {categories.length}
                  </strong>{' '}
                  categories
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {products.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 4,
                overflowX: 'auto',
                marginBottom: 24,
                borderBottom: `1px solid ${S.border}`,
                paddingBottom: 1,
              }}
            >
              {[
                { id: ALL_TAB, name: 'All' },
                ...categories.map((c) => ({ id: c.id, name: c.name })),
              ].map((tab) => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-active={active}
                    onClick={() => setActiveTab(tab.id)}
                    className="shop-tab"
                    style={{
                      flexShrink: 0,
                      padding: '12px 16px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 500,
                      color: active ? S.ink : S.ink3,
                      transition: 'color 120ms',
                    }}
                  >
                    {tab.name}
                    <span
                      style={{
                        fontFamily: S.mono,
                        fontSize: 11,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: active ? `${accent}18` : S.surface2,
                        color: active ? accent : S.ink4,
                        fontWeight: 600,
                      }}
                    >
                      {tabCount(tab.id)}
                    </span>
                  </button>
                )
              })}
            </div>

            {visibleProducts.length === 0 ? (
              <div
                style={{
                  border: `1px dashed ${S.borderStrong}`,
                  background: S.surface,
                  borderRadius: 18,
                  padding: '60px 20px',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 14, color: S.ink3, margin: 0 }}>
                  No products match your search.
                </p>
              </div>
            ) : (
              <div className="shop-grid">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    quantity={quantities[product.id] ?? 0}
                    accent={accent}
                    onAdd={() => setQty(product.id, (quantities[product.id] ?? 0) + 1)}
                    onChange={(n) => setQty(product.id, n)}
                    onPreview={() => setPreviewProduct(product)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {count > 0 && !cartOpen ? (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 18px',
            borderRadius: 999,
            background: S.ink,
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            boxShadow: S.shadowLg,
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 22,
              height: 22,
              padding: '0 7px',
              borderRadius: 999,
              background: accent,
              color: 'white',
              fontFamily: S.mono,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {count}
          </span>
          View cart
          <span
            style={{
              fontFamily: S.mono,
              fontSize: 12.5,
              opacity: 0.8,
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              paddingLeft: 14,
            }}
          >
            {subtotalLabel}
          </span>
        </button>
      ) : null}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        accent={accent}
        lines={cartLines}
        subtotalLabel={subtotalLabel}
        count={count}
        page={page}
        claims={claims}
        rawToken={rawToken}
        items={items}
        onChangeQty={setQty}
      />

      {previewProduct ? (
        <ProductModal
          product={previewProduct}
          quantity={quantities[previewProduct.id] ?? 0}
          accent={accent}
          onClose={() => setPreviewProduct(null)}
          onAdd={() => setQty(previewProduct.id, (quantities[previewProduct.id] ?? 0) + 1)}
          onChange={(n) => setQty(previewProduct.id, n)}
        />
      ) : null}
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function SearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <svg
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: S.ink4,
          pointerEvents: 'none',
        }}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search products"
        className="shop-input"
        style={{ paddingLeft: 36, borderRadius: 999 }}
      />
    </div>
  )
}

function ProductCard({
  product,
  quantity,
  accent,
  onAdd,
  onChange,
  onPreview,
}: {
  product: PublicProductCard
  quantity: number
  accent: string
  onAdd: () => void
  onChange: (n: number) => void
  onPreview: () => void
}) {
  const outOfStock = product.inventory_status === 'out_of_stock'
  return (
    <article className="shop-card">
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${product.title}`}
        className="shop-card-img"
      >
        {product.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.cover_image_url} alt={product.title} />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              fontFamily: S.mono,
              fontSize: 11,
              color: S.ink4,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            No image
          </div>
        )}
        {outOfStock ? (
          <span
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              padding: '4px 9px',
              borderRadius: 999,
              background: 'rgba(20,17,11,0.78)',
              color: 'white',
              fontFamily: S.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Sold out
          </span>
        ) : null}
        {product.tags[0] ? (
          <span
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 9px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(6px)',
              color: S.ink2,
              fontFamily: S.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              boxShadow: S.shadowSm,
            }}
          >
            {product.tags[0]}
          </span>
        ) : null}
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '14px 14px 16px',
          gap: 4,
        }}
      >
        <h3
          title={product.title}
          style={{
            margin: 0,
            fontSize: 14.5,
            fontWeight: 600,
            color: S.ink,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {product.title}
        </h3>
        {product.summary ? (
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              color: S.ink3,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {product.summary}
          </p>
        ) : null}

        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: S.serif,
              fontSize: 19,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              color: S.ink,
            }}
          >
            {product.price_label}
          </span>
        </div>

        <div style={{ marginTop: 12 }}>
          {quantity === 0 ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={outOfStock}
              className="shop-btn-primary"
              style={{ width: '100%' }}
            >
              {outOfStock ? 'Unavailable' : 'Add to cart'}
            </button>
          ) : (
            <QtyStepper value={quantity} accent={accent} onChange={onChange} />
          )}
        </div>
      </div>
    </article>
  )
}

function QtyStepper({
  value,
  accent,
  onChange,
  compact,
}: {
  value: number
  accent: string
  onChange: (n: number) => void
  compact?: boolean
}) {
  const h = compact ? 30 : 38
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: S.surface,
        border: `1.5px solid ${accent}`,
        borderRadius: 999,
        padding: 3,
        height: h,
      }}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease"
        style={{
          width: h - 8,
          height: h - 8,
          borderRadius: 999,
          background: 'transparent',
          border: 'none',
          color: accent,
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        −
      </button>
      <span
        style={{
          fontFamily: S.mono,
          fontSize: 13,
          fontWeight: 600,
          color: S.ink,
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase"
        style={{
          width: h - 8,
          height: h - 8,
          borderRadius: 999,
          background: accent,
          border: 'none',
          color: 'white',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        +
      </button>
    </div>
  )
}

function CartDrawer({
  open,
  onClose,
  accent,
  lines,
  subtotalLabel,
  count,
  page,
  claims,
  rawToken,
  items,
  onChangeQty,
}: {
  open: boolean
  onClose: () => void
  accent: string
  lines: { id: string; quantity: number; product?: PublicProductCard }[]
  subtotalLabel: string
  count: number
  page: KindRendererProps['page']
  claims: KindRendererProps['claims']
  rawToken: KindRendererProps['rawToken']
  items: { id: string; quantity: number }[]
  onChangeQty: (id: string, n: number) => void
}) {
  return (
    <>
      <div
        onClick={onClose}
        className="shop-drawer-bg"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 220ms ease',
        }}
      />
      <aside
        className="shop-drawer"
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100%',
          width: '100%',
          maxWidth: 440,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: `1px solid ${S.border}`,
            background: `linear-gradient(180deg, ${S.surface2} 0%, ${S.surface} 100%)`,
          }}
        >
          <div>
            <div className="shop-eyebrow">Cart</div>
            <h2
              style={{
                fontFamily: S.serif,
                fontSize: 22,
                fontWeight: 400,
                margin: '2px 0 0',
                letterSpacing: '-0.01em',
                color: S.ink,
              }}
            >
              {count} {count === 1 ? 'item' : 'items'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: 'transparent',
              border: `1px solid ${S.border}`,
              display: 'grid',
              placeItems: 'center',
              color: S.ink3,
              cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          action="/api/action-pages/submit"
          method="post"
          style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
        >
          <input type="hidden" name="slug" value={page.slug} />
          {claims ? (
            <>
              <input type="hidden" name="p" value={claims.psid} />
              <input type="hidden" name="g" value={claims.pageId} />
              <input type="hidden" name="e" value={String(claims.exp)} />
              {rawToken ? <input type="hidden" name="t" value={rawToken} /> : null}
            </>
          ) : null}
          <input type="hidden" name="data.items" value={JSON.stringify(items)} />

          <div className="shop-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
            {lines.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  paddingTop: 40,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 999,
                    background: `${accent}15`,
                    color: accent,
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <CartIcon size={26} />
                </div>
                <p
                  style={{
                    fontFamily: S.serif,
                    fontSize: 20,
                    fontWeight: 400,
                    color: S.ink,
                    margin: 0,
                    letterSpacing: '-0.01em',
                  }}
                >
                  Your cart is empty
                </p>
                <p style={{ fontSize: 13, color: S.ink3, margin: '6px 0 0' }}>
                  Browse the store and add items to get started.
                </p>
              </div>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {lines.map(({ id, quantity, product }) => {
                  if (!product) return null
                  const lineTotal = (product.price_amount ?? 0) * quantity
                  let lineLabel = product.price_label
                  try {
                    lineLabel = new Intl.NumberFormat(undefined, {
                      style: 'currency',
                      currency: product.currency,
                    }).format(lineTotal)
                  } catch {
                    /* keep fallback */
                  }
                  return (
                    <li
                      key={id}
                      style={{
                        display: 'flex',
                        gap: 12,
                        background: S.surface,
                        border: `1px solid ${S.border}`,
                        borderRadius: 14,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          flexShrink: 0,
                          borderRadius: 10,
                          overflow: 'hidden',
                          background: S.surface2,
                        }}
                      >
                        {product.cover_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.cover_image_url}
                            alt={product.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          minWidth: 0,
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: S.ink,
                            lineHeight: 1.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {product.title}
                        </p>
                        <p
                          style={{
                            margin: '2px 0 0',
                            fontFamily: S.mono,
                            fontSize: 11.5,
                            color: S.ink4,
                          }}
                        >
                          {product.price_label}
                        </p>
                        <div
                          style={{
                            marginTop: 'auto',
                            paddingTop: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <div style={{ width: 110 }}>
                            <QtyStepper
                              compact
                              value={quantity}
                              accent={accent}
                              onChange={(n) => onChangeQty(id, n)}
                            />
                          </div>
                          <span
                            style={{
                              fontFamily: S.serif,
                              fontSize: 16,
                              color: S.ink,
                              letterSpacing: '-0.01em',
                            }}
                          >
                            {lineLabel}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {lines.length > 0 ? (
              <div style={{ marginTop: 26 }}>
                <div className="shop-eyebrow" style={{ marginBottom: 10 }}>
                  Your details
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    required
                    name="data.customer_name"
                    placeholder="Full name"
                    className="shop-input"
                  />
                  <input
                    required
                    name="data.customer_phone"
                    placeholder="Phone"
                    className="shop-input"
                  />
                  <input
                    type="email"
                    name="data.customer_email"
                    placeholder="Email (optional)"
                    className="shop-input"
                  />
                  <textarea
                    name="data.customer_notes"
                    placeholder="Order notes (optional)"
                    rows={3}
                    className="shop-input"
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div
            style={{
              borderTop: `1px solid ${S.border}`,
              background: S.surface,
              padding: '16px 22px 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 13, color: S.ink3 }}>Subtotal</span>
              <span
                style={{
                  fontFamily: S.serif,
                  fontSize: 24,
                  letterSpacing: '-0.015em',
                  color: S.ink,
                }}
              >
                {subtotalLabel}
              </span>
            </div>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 11.5,
                color: S.ink4,
                fontFamily: S.mono,
              }}
            >
              Taxes & shipping calculated at confirmation.
            </p>
            <button
              type="submit"
              disabled={count === 0}
              className="shop-btn-primary"
              style={{ width: '100%', padding: '13px 18px', fontSize: 14 }}
            >
              {count > 0 ? `Checkout · ${subtotalLabel}` : 'Cart is empty'}
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

function ProductModal({
  product,
  quantity,
  accent,
  onClose,
  onAdd,
  onChange,
}: {
  product: PublicProductCard
  quantity: number
  accent: string
  onClose: () => void
  onAdd: () => void
  onChange: (n: number) => void
}) {
  const outOfStock = product.inventory_status === 'out_of_stock'
  return (
    <div
      onClick={onClose}
      className="shop-drawer-bg"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="shop-modal"
        style={{
          width: '100%',
          maxWidth: 720,
          background: S.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(20,17,11,0.18)',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 2,
            width: 36,
            height: 36,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(6px)',
            border: `1px solid ${S.border}`,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            color: S.ink2,
            boxShadow: S.shadowSm,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="shop-modal-grid">
          <div style={{ aspectRatio: '1 / 1', background: S.surface2, width: '100%' }}>
            {product.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.cover_image_url}
                alt={product.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: S.mono,
                  color: S.ink4,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                No image
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 26px' }}>
            {product.tags.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {product.tags.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    style={{
                      fontFamily: S.mono,
                      fontSize: 10.5,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      padding: '4px 9px',
                      borderRadius: 999,
                      background: S.surface2,
                      color: S.ink2,
                      border: `1px solid ${S.border}`,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            <h2
              style={{
                margin: 0,
                fontFamily: S.serif,
                fontSize: 26,
                fontWeight: 400,
                letterSpacing: '-0.015em',
                lineHeight: 1.15,
                color: S.ink,
              }}
            >
              {product.title}
            </h2>
            <p
              style={{
                margin: '8px 0 0',
                fontFamily: S.serif,
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: S.accentInk,
              }}
            >
              {product.price_label}
            </p>
            {product.description || product.summary ? (
              <p
                className="shop-scroll"
                style={{
                  margin: '14px 0 0',
                  maxHeight: 200,
                  overflowY: 'auto',
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  color: S.ink2,
                }}
              >
                {product.description ?? product.summary}
              </p>
            ) : null}

            <div style={{ marginTop: 'auto', paddingTop: 22 }}>
              {quantity === 0 ? (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={outOfStock}
                  className="shop-btn-primary"
                  style={{ width: '100%', padding: '13px 18px', fontSize: 14 }}
                >
                  {outOfStock ? 'Unavailable' : 'Add to cart'}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <QtyStepper value={quantity} accent={accent} onChange={onChange} />
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shop-btn-primary"
                    style={{ flex: 1, padding: '11px 18px' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        border: `1px dashed ${S.borderStrong}`,
        background: S.surface,
        borderRadius: 22,
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontFamily: S.serif,
          fontSize: 22,
          fontWeight: 400,
          color: S.ink,
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        No products yet
      </p>
      <p style={{ marginTop: 6, fontSize: 13, color: S.ink3 }}>
        Check back soon — new arrivals are on the way.
      </p>
    </div>
  )
}

function CartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  )
}
