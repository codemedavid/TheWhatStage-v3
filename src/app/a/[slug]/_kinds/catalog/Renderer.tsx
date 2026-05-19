'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { CSSProperties } from 'react'
import type { KindRendererProps } from '../types'
import type { PublicProductCard } from '@/lib/business/public-dto'
import type { PublicPaymentMethod } from '@/lib/payment-methods/public'
import './catalog.css'

interface Category {
  id: string
  name: string
  product_ids: string[]
}

interface CheckoutField {
  id: string
  key: string
  label: string
  type: 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'select' | 'image'
  required: boolean
  placeholder?: string
  options?: string[]
}

interface CatalogBrand {
  name?: string
  tagline?: string
  description?: string
  logo_url?: string
}

interface CatalogConfig {
  theme?: { accent_color?: string }
  brand?: CatalogBrand
  categories?: Category[]
  checkout_fields?: CheckoutField[]
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
  paymentMethods = [],
}: KindRendererProps) {
  const config = (page.config ?? {}) as CatalogConfig
  const accent = config.theme?.accent_color ?? S.accent
  const brand = config.brand ?? {}
  const brandName = brand.name?.trim() || page.title || 'Store'
  const brandTagline = brand.tagline?.trim() || ''
  const brandDescription = brand.description?.trim() || page.description || ''
  const brandLogoUrl = brand.logo_url?.trim() || ''
  const brandInitial = brandName.slice(0, 1).toUpperCase()
  const categories = (config.categories ?? []).filter((c) => c.product_ids.length > 0)
  const hasTabs = categories.length > 0
  const checkoutFields = useMemo<CheckoutField[]>(
    () =>
      (config.checkout_fields ?? []).filter(
        (f): f is CheckoutField => !!f && !!f.key && !!f.label,
      ),
    [config.checkout_fields],
  )

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [, startTransition] = useTransition()

  const cartUrl = useMemo(() => {
    if (!claims || !rawToken) return null
    const sp = new URLSearchParams()
    sp.set('p', claims.psid)
    sp.set('g', claims.pageId)
    sp.set('e', String(claims.exp))
    sp.set('t', rawToken)
    return `/api/action-pages/${page.slug}/cart?${sp.toString()}`
  }, [claims, rawToken, page.slug])

  // Hydrate from saved cart on mount.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!cartUrl || hydrated.current) return
    hydrated.current = true
    fetch(cartUrl, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body: { items?: { id: string; quantity: number }[] }) => {
        const next: Record<string, number> = {}
        for (const i of body.items ?? []) {
          if (i.id && typeof i.quantity === 'number' && i.quantity > 0) {
            next[i.id] = Math.min(999, Math.floor(i.quantity))
          }
        }
        if (Object.keys(next).length > 0) {
          startTransition(() => setQuantities(next))
        }
      })
      .catch(() => {
        /* network/parse failure — keep local state */
      })
  }, [cartUrl, startTransition])

  // Debounced write of the current quantities to the server.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const pendingSnapshot = useRef<Record<string, number> | null>(null)

  useEffect(() => {
    if (!cartUrl) return
    if (!hydrated.current) return
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      const snapshot = { ...quantities }
      if (inFlight.current) {
        pendingSnapshot.current = snapshot
        return
      }
      void sendSnapshot(snapshot)
    }, 500)
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }

    async function sendSnapshot(snap: Record<string, number>) {
      inFlight.current = true
      try {
        const items = Object.entries(snap)
          .filter(([, q]) => q > 0)
          .map(([id, quantity]) => ({ id, quantity }))
        await fetch(cartUrl!, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items }),
        })
      } catch {
        /* swallow — visitor's local state is still correct */
      } finally {
        inFlight.current = false
        if (pendingSnapshot.current) {
          const queued = pendingSnapshot.current
          pendingSnapshot.current = null
          void sendSnapshot(queued)
        }
      }
    }
  }, [quantities, cartUrl])

  const [activeTab, setActiveTab] = useState<string>(ALL_TAB)
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [previewProduct, setPreviewProduct] = useState<PublicProductCard | null>(null)
  const [pulse, setPulse] = useState(0)

  // Open the product modal when arriving with ?product=<slug> — used by
  // Messenger carousel "View product" links to deep-link into a single item.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const slug = new URLSearchParams(window.location.search).get('product')
    if (!slug) return
    const match = products.find((p) => p.slug === slug)
    if (match) startTransition(() => setPreviewProduct(match))
  }, [products, startTransition])

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
      {/* Nav */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          borderBottom: `1px solid ${S.border}`,
          background: 'rgba(251,249,244,0.86)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '14px 28px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            alignItems: 'center',
            gap: 24,
          }}
        >
          {/* Brand mark */}
          <a
            href="#"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              color: S.ink,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: S.ink,
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontFamily: S.serif,
                fontSize: 17,
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogoUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                brandInitial
              )}
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                whiteSpace: 'nowrap',
              }}
            >
              {brandName}
            </span>
          </a>

          {/* Search — centred, hidden on mobile */}
          <div className="shop-hide-mobile" style={{ display: 'flex', justifyContent: 'center' }}>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          {/* Cart */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 999,
                    background: accent,
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: S.mono,
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    border: '2px solid #FBF9F4',
                  }}
                >
                  {count}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {/* Mobile search */}
        <div
          className="shop-show-mobile"
          style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 12px' }}
        >
          <SearchInput value={search} onChange={setSearch} />
        </div>
      </header>

      {/* Hero — profile style */}
      <section
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 'clamp(40px, 6vw, 64px) 28px clamp(28px, 4vw, 40px)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            background: S.ink,
            color: 'white',
            display: 'grid',
            placeItems: 'center',
            marginBottom: 18,
            fontFamily: S.serif,
            fontSize: 26,
            overflow: 'hidden',
            boxShadow: '0 0 0 4px rgba(255,255,255,0.6), 0 0 0 5px ' + S.border,
          }}
        >
          {brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brandLogoUrl}
              alt={brandName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            brandInitial
          )}
        </div>

        {/* Tagline eyebrow */}
        {brandTagline && (
          <div
            style={{
              fontFamily: S.mono,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: accent,
              fontWeight: 500,
              marginBottom: 14,
            }}
          >
            {brandTagline}
          </div>
        )}

        {/* Brand name */}
        <h1
          style={{
            fontFamily: S.serif,
            fontSize: 'clamp(36px, 6vw, 56px)',
            fontWeight: 400,
            letterSpacing: '-0.02em',
            lineHeight: 1.04,
            margin: '0 0 14px',
            color: S.ink,
          }}
        >
          {brandName}
        </h1>

        {/* Description */}
        {brandDescription && (
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              color: S.ink3,
              margin: '0 auto',
              maxWidth: 480,
            }}
          >
            {brandDescription}
          </p>
        )}
      </section>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 120px' }}>
        {products.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Toolbar: tabs + search */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: hasTabs ? '1fr auto' : '1fr',
                gap: 12,
                alignItems: 'center',
                borderTop: `1px solid ${S.border}`,
                padding: '14px 0 20px',
                marginBottom: 8,
              }}
            >
              <div
                role="tablist"
                style={{
                  display: 'flex',
                  gap: 4,
                  overflowX: 'auto',
                  flexWrap: 'wrap',
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
                      onClick={() => setActiveTab(tab.id)}
                      className="shop-tab"
                      style={{
                        flexShrink: 0,
                        height: 34,
                        padding: '0 14px',
                        background: active ? S.ink : 'transparent',
                        border: active ? 'none' : `1px solid transparent`,
                        borderRadius: 999,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 500,
                        color: active ? 'white' : S.ink2,
                        transition: 'all 120ms',
                      }}
                    >
                      {tab.name}
                      <span
                        style={{
                          fontFamily: S.mono,
                          fontSize: 10.5,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: active ? 'rgba(255,255,255,0.16)' : S.surface2,
                          color: active ? 'white' : S.ink4,
                          fontWeight: 600,
                        }}
                      >
                        {tabCount(tab.id)}
                      </span>
                    </button>
                  )
                })}
              </div>
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
        checkoutFields={checkoutFields}
        paymentMethods={paymentMethods}
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

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${S.border}`,
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <span style={{ fontSize: 12.5, color: S.ink4 }}>
          &copy; {brandName}, {new Date().getFullYear()}
        </span>
        <div
          style={{
            display: 'flex',
            gap: 18,
            fontSize: 12.5,
            color: S.ink3,
          }}
        >
          {['Privacy', 'Terms', 'Refunds'].map((l) => (
            <a
              key={l}
              href="#"
              style={{ color: S.ink3, textDecoration: 'none' }}
            >
              {l}
            </a>
          ))}
        </div>
      </footer>
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
  checkoutFields,
  paymentMethods,
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
  checkoutFields: CheckoutField[]
  paymentMethods: PublicPaymentMethod[]
}) {
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [paymentMethodId, setPaymentMethodId] = useState<string>(() =>
    paymentMethods.length === 1 ? paymentMethods[0].id : '',
  )
  const [proofUrl, setProofUrl] = useState('')
  const [proofFileId, setProofFileId] = useState('')
  const [uploadingProof, setUploadingProof] = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [paymentNote, setPaymentNote] = useState('')
  const selectedMethod = useMemo(
    () => paymentMethods.find((m) => m.id === paymentMethodId) ?? null,
    [paymentMethods, paymentMethodId],
  )
  const paymentEnabled =
    (page.config as { payment?: { enabled?: boolean } }).payment?.enabled !== false

  async function uploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingProof(true); setProofError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/action-pages/${page.slug}/payment-proofs`, {
        method: 'POST', body: fd,
      })
      const b = await res.json()
      if (!res.ok) throw new Error(b?.error ?? 'upload_failed')
      setProofUrl(b.url); setProofFileId(b.fileId)
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setUploadingProof(false)
    }
  }
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
          <input
            type="hidden"
            name="data.custom"
            value={JSON.stringify(customValues)}
          />
          {paymentMethodId ? (
            <input
              type="hidden"
              name="data.payment_method_id"
              value={paymentMethodId}
            />
          ) : null}

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
                  {checkoutFields.map((f) => {
                    const value = customValues[f.key] ?? ''
                    const setValue = (v: string) =>
                      setCustomValues((prev) => ({ ...prev, [f.key]: v }))
                    const placeholder =
                      f.placeholder ?? (f.required ? f.label : `${f.label} (optional)`)
                    if (f.type === 'long_text') {
                      return (
                        <textarea
                          key={f.id}
                          required={f.required}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          placeholder={placeholder}
                          rows={3}
                          className="shop-input"
                          style={{ resize: 'vertical' }}
                        />
                      )
                    }
                    if (f.type === 'select') {
                      return (
                        <select
                          key={f.id}
                          required={f.required}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          className="shop-input"
                        >
                          <option value="">{placeholder}</option>
                          {(f.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )
                    }
                    if (f.type === 'image') {
                      return (
                        <ImageUploadField
                          key={f.id}
                          label={f.label}
                          required={f.required}
                          value={value}
                          slug={page.slug}
                          onChange={setValue}
                          accent={accent}
                        />
                      )
                    }
                    const inputType =
                      f.type === 'email'
                        ? 'email'
                        : f.type === 'phone'
                          ? 'tel'
                          : f.type === 'number'
                            ? 'number'
                            : 'text'
                    return (
                      <input
                        key={f.id}
                        type={inputType}
                        required={f.required}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="shop-input"
                      />
                    )
                  })}
                </div>

                {paymentEnabled && paymentMethods.length > 0 ? (
                  <div style={{ marginTop: 22 }}>
                    <div className="shop-eyebrow" style={{ marginBottom: 10 }}>
                      Payment
                    </div>
                    <PaymentMethodsPicker
                      methods={paymentMethods}
                      selectedId={paymentMethodId}
                      onSelect={setPaymentMethodId}
                      accent={accent}
                    />
                    {selectedMethod ? (
                      <PaymentMethodDetails method={selectedMethod} />
                    ) : null}
                    <div style={{ padding: '0 0 14px' }}>
                      <label className="grid gap-1 text-sm" style={{ display: 'grid', gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>Payment screenshot (required)</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={uploadProof}
                          disabled={uploadingProof}
                        />
                        {uploadingProof ? <span>Uploading…</span> : null}
                        {proofError ? <span style={{ color: '#b91c1c' }}>{proofError}</span> : null}
                        {proofUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={proofUrl} alt="Proof" style={{ width: 120, height: 120, borderRadius: 8, objectFit: 'cover', marginTop: 6 }} />
                        ) : null}
                      </label>
                      <label className="grid gap-1 text-sm" style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                        <span style={{ fontWeight: 500 }}>Note (optional)</span>
                        <textarea
                          value={paymentNote}
                          onChange={(e) => setPaymentNote(e.target.value)}
                          maxLength={500}
                          style={{ minHeight: 60, borderRadius: 8, border: `1px solid ${S.border}`, padding: 8 }}
                        />
                      </label>
                      {proofUrl ? <input type="hidden" name="data.payment_proof_url" value={proofUrl} /> : null}
                      {proofFileId ? <input type="hidden" name="data.payment_proof_file_id" value={proofFileId} /> : null}
                      {paymentNote ? <input type="hidden" name="data.payment_note" value={paymentNote} /> : null}
                    </div>
                  </div>
                ) : null}
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
              disabled={count === 0 || (paymentEnabled && paymentMethods.length > 0 && (!paymentMethodId || !proofUrl))}
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

function ImageUploadField({
  label,
  required,
  value,
  slug,
  onChange,
  accent,
}: {
  label: string
  required: boolean
  value: string
  slug: string
  onChange: (v: string) => void
  accent: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/action-pages/${slug}/customer-images`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `upload failed (${res.status})`)
      }
      const { url } = (await res.json()) as { url: string }
      onChange(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: S.ink3,
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
        {required ? (
          <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{
            width: 96,
            height: 96,
            flexShrink: 0,
            borderRadius: 12,
            border: `1.5px dashed ${value ? accent : S.borderStrong}`,
            background: value ? S.surface : S.surface2,
            color: S.ink3,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            padding: 0,
          }}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt={label}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span
              style={{
                fontFamily: S.mono,
                fontSize: 10.5,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: S.ink4,
              }}
            >
              {uploading ? 'Uploading…' : 'Tap to upload'}
            </span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
          }}
          required={required && !value}
        />
        <div style={{ flex: 1, fontSize: 12, color: S.ink3, lineHeight: 1.45 }}>
          JPEG, PNG, or WebP — up to 5 MB.
          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              style={{
                display: 'block',
                marginTop: 6,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: '#DC2626',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Remove
            </button>
          ) : null}
          {error ? (
            <p
              style={{
                marginTop: 4,
                color: '#DC2626',
                fontSize: 11.5,
              }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PaymentMethodsPicker({
  methods,
  selectedId,
  onSelect,
  accent,
}: {
  methods: PublicPaymentMethod[]
  selectedId: string
  onSelect: (id: string) => void
  accent: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {methods.map((m) => {
        const active = m.id === selectedId
        return (
          <label
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 12,
              cursor: 'pointer',
              background: active ? `${accent}10` : S.surface,
              border: `1.5px solid ${active ? accent : S.border}`,
              transition: 'all 140ms',
            }}
          >
            <input
              type="radio"
              name="__pm_select"
              value={m.id}
              checked={active}
              onChange={() => onSelect(m.id)}
              style={{ accentColor: accent }}
            />
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                overflow: 'hidden',
                background: S.surface2,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                fontFamily: S.mono,
                fontSize: 10,
                color: S.ink3,
                textTransform: 'uppercase',
              }}
            >
              {m.qr_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.qr_image_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : m.kind === 'gcash' ? (
                'GC'
              ) : m.kind === 'bank_transfer' ? (
                'BANK'
              ) : (
                '···'
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: S.ink }}>
                {m.name}
              </div>
              <div style={{ fontSize: 11.5, color: S.ink3, marginTop: 1 }}>
                {m.kind === 'gcash'
                  ? 'GCash'
                  : m.kind === 'bank_transfer'
                    ? `Bank transfer${m.bank_name ? ' · ' + m.bank_name : ''}`
                    : 'Other'}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}

function PaymentMethodDetails({ method }: { method: PublicPaymentMethod }) {
  return (
    <div
      style={{
        marginTop: 12,
        background: S.surface2,
        border: `1px solid ${S.border}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: method.qr_image_url ? 'auto 1fr' : '1fr',
          gap: 14,
        }}
      >
        {method.qr_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={method.qr_image_url}
            alt={`${method.name} QR`}
            style={{
              width: 120,
              height: 120,
              objectFit: 'contain',
              borderRadius: 8,
              background: S.surface,
              border: `1px solid ${S.border}`,
            }}
          />
        ) : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12.5,
            color: S.ink2,
          }}
        >
          {method.account_name ? (
            <div>
              <span style={{ color: S.ink4 }}>Account name · </span>
              {method.account_name}
            </div>
          ) : null}
          {method.account_number ? (
            <div>
              <span style={{ color: S.ink4 }}>
                {method.kind === 'gcash' ? 'Number · ' : 'Account # · '}
              </span>
              <span style={{ fontFamily: S.mono }}>{method.account_number}</span>
            </div>
          ) : null}
          {method.bank_name ? (
            <div>
              <span style={{ color: S.ink4 }}>Bank · </span>
              {method.bank_name}
              {method.branch ? ` · ${method.branch}` : ''}
            </div>
          ) : null}
          {method.instructions ? (
            <p
              style={{
                marginTop: 4,
                color: S.ink3,
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-line',
              }}
            >
              {method.instructions}
            </p>
          ) : null}
        </div>
      </div>
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
