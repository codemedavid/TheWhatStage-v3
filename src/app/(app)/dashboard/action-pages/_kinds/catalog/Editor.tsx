'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KindEditorProps } from '../types'
import { createProduct } from '../../../business/products/actions'

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cat_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

interface ProductItem {
  id: string
  title: string
  summary: string | null
  status: string
  cover_image_url: string | null
  price_label: string
}

interface Collection {
  id: string
  name: string
  product_ids: string[]
}

interface CatalogConfig {
  theme: { accent_color: string }
  product_ids: string[]
  categories: Collection[]
}

const PRESET_SWATCHES = [
  '#059669',
  '#5C6AC4',
  '#DE3618',
  '#F49342',
  '#9C6ADE',
  '#0EA5E9',
  '#111827',
]

function parseCatalogConfig(raw: Record<string, unknown>): CatalogConfig {
  const theme = (raw.theme ?? {}) as Record<string, unknown>
  return {
    theme: {
      accent_color:
        typeof theme.accent_color === 'string' ? theme.accent_color : '#059669',
    },
    product_ids: Array.isArray(raw.product_ids) ? (raw.product_ids as string[]) : [],
    categories: Array.isArray(raw.categories)
      ? (raw.categories as Collection[])
      : [],
  }
}

export default function CatalogEditor({ page }: KindEditorProps) {
  const returnHref = `/dashboard/action-pages/${page.id}`
  const [config, setConfig] = useState<CatalogConfig>(() =>
    parseCatalogConfig(page.config ?? {}),
  )
  const [products, setProducts] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'live' | 'hidden'>('all')
  const [activeCollection, setActiveCollection] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/business/products')
      .then((r) => r.json())
      .then((data) => {
        setProducts(Array.isArray(data.products) ? data.products : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isAuto = config.product_ids.length === 0
  const publishedProducts = useMemo(
    () => products.filter((p) => p.status === 'published'),
    [products],
  )
  const visibleIds = useMemo(
    () => (isAuto ? publishedProducts.map((p) => p.id) : config.product_ids),
    [isAuto, publishedProducts, config.product_ids],
  )
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds])

  const productMap = useMemo(() => {
    const map: Record<string, ProductItem> = {}
    for (const p of products) map[p.id] = p
    return map
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (filter === 'live' && !visibleSet.has(p.id)) return false
      if (filter === 'hidden' && visibleSet.has(p.id)) return false
      if (activeCollection) {
        const cat = config.categories.find((c) => c.id === activeCollection)
        if (!cat || !cat.product_ids.includes(p.id)) return false
      }
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        (p.summary ?? '').toLowerCase().includes(q)
      )
    })
  }, [
    products,
    search,
    filter,
    visibleSet,
    activeCollection,
    config.categories,
  ])

  function setProductVisible(id: string, visible: boolean) {
    setConfig((c) => {
      let ids: string[]
      if (c.product_ids.length === 0) {
        // currently auto — switch to custom seeded with all published
        ids = publishedProducts.map((p) => p.id)
      } else {
        ids = [...c.product_ids]
      }
      const has = ids.includes(id)
      if (visible && !has) ids.push(id)
      if (!visible && has) ids = ids.filter((x) => x !== id)
      return { ...c, product_ids: ids }
    })
  }

  function resetToAuto() {
    setConfig((c) => ({ ...c, product_ids: [] }))
  }

  function customizeVisibility() {
    setConfig((c) => ({
      ...c,
      product_ids: publishedProducts.map((p) => p.id),
    }))
  }

  function bulkSetVisibility(ids: string[], visible: boolean) {
    setConfig((c) => {
      let cur =
        c.product_ids.length === 0 ? publishedProducts.map((p) => p.id) : [...c.product_ids]
      if (visible) {
        for (const id of ids) if (!cur.includes(id)) cur.push(id)
      } else {
        cur = cur.filter((x) => !ids.includes(x))
      }
      return { ...c, product_ids: cur }
    })
  }

  function addCollection(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = genId()
    setConfig((c) => ({
      ...c,
      categories: [...c.categories, { id, name: trimmed, product_ids: [] }],
    }))
  }

  function renameCollection(id: string, name: string) {
    setConfig((c) => ({
      ...c,
      categories: c.categories.map((cat) =>
        cat.id === id ? { ...cat, name } : cat,
      ),
    }))
  }

  function removeCollection(id: string) {
    setConfig((c) => ({
      ...c,
      categories: c.categories.filter((cat) => cat.id !== id),
    }))
    if (activeCollection === id) setActiveCollection(null)
  }

  function moveCollection(id: string, dir: -1 | 1) {
    setConfig((c) => {
      const idx = c.categories.findIndex((cat) => cat.id === id)
      if (idx < 0) return c
      const next = idx + dir
      if (next < 0 || next >= c.categories.length) return c
      const arr = [...c.categories]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return { ...c, categories: arr }
    })
  }

  function toggleProductInCollection(catId: string, productId: string) {
    setConfig((c) => ({
      ...c,
      categories: c.categories.map((cat) => {
        if (cat.id !== catId) return cat
        const has = cat.product_ids.includes(productId)
        return {
          ...cat,
          product_ids: has
            ? cat.product_ids.filter((x) => x !== productId)
            : [...cat.product_ids, productId],
        }
      }),
    }))
  }

  const liveCount = visibleIds.length
  const totalCount = products.length

  return (
    <div className="space-y-5">
      <input type="hidden" name="config" value={JSON.stringify(config)} />
      <input type="hidden" name="from" value={returnHref} />

      {/* Stat bar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="On storefront"
          value={liveCount}
          tone="emerald"
          hint={isAuto ? 'Auto · all published' : 'Custom selection'}
        />
        <Stat
          label="Total products"
          value={totalCount}
          tone="zinc"
          hint={`${publishedProducts.length} published`}
        />
        <Stat
          label="Collections"
          value={config.categories.length}
          tone="violet"
          hint={config.categories.length === 0 ? 'None yet' : 'Tabs on storefront'}
        />
        <AccentStat
          color={config.theme.accent_color}
          onChange={(v) =>
            setConfig((c) => ({ ...c, theme: { ...c.theme, accent_color: v } }))
          }
        />
      </div>

      {/* Collections strip */}
      <CollectionsStrip
        collections={config.categories}
        active={activeCollection}
        onActivate={(id) => setActiveCollection(id)}
        onClear={() => setActiveCollection(null)}
        onAdd={addCollection}
        onRename={renameCollection}
        onRemove={removeCollection}
        onMove={moveCollection}
        countsById={Object.fromEntries(
          config.categories.map((c) => [c.id, c.product_ids.length]),
        )}
        totalProductCount={products.length}
      />

      {/* Main card */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
        {/* Card header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-zinc-400">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products"
                className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="inline-flex shrink-0 rounded-md border border-zinc-200 bg-white p-0.5 text-[12px] font-medium">
              {(
                [
                  { v: 'all', l: 'All' },
                  { v: 'live', l: 'On storefront' },
                  { v: 'hidden', l: 'Hidden' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setFilter(opt.v)}
                  className={`rounded px-2.5 py-1 transition ${
                    filter === opt.v
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            formAction={createProduct}
            formNoValidate
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <PlusIcon /> Add product
          </button>
        </div>

        {/* Auto banner */}
        {isAuto && totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5">
            <div className="flex items-start gap-2 text-[12.5px] text-amber-900">
              <SparkIcon />
              <span>
                <b>Auto mode</b> · all <b>{publishedProducts.length}</b>{' '}
                published products show on the storefront. New ones appear
                automatically.
              </span>
            </div>
            <button
              type="button"
              onClick={customizeVisibility}
              className="rounded-md bg-amber-900 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-800"
            >
              Customize
            </button>
          </div>
        )}
        {!isAuto && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
            <div className="flex items-start gap-2 text-[12.5px] text-zinc-700">
              <CheckIcon />
              <span>
                <b>Custom selection</b> · you control which products show, one
                by one.
              </span>
            </div>
            <button
              type="button"
              onClick={resetToAuto}
              className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Reset to auto
            </button>
          </div>
        )}

        {/* Body */}
        {loading ? (
          <Loader />
        ) : products.length === 0 ? (
          <Empty />
        ) : filteredProducts.length === 0 ? (
          <div className="px-4 py-16 text-center text-[13px] text-zinc-500">
            No products match{' '}
            {search ? (
              <>
                “<b className="text-zinc-700">{search}</b>”
              </>
            ) : (
              'this filter'
            )}
            .
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filteredProducts.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                visible={visibleSet.has(product.id)}
                collections={config.categories}
                returnHref={returnHref}
                onToggleVisible={(v) => setProductVisible(product.id, v)}
                onToggleCollection={(catId) =>
                  toggleProductInCollection(catId, product.id)
                }
              />
            ))}
          </ul>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 text-[11.5px] text-zinc-500">
          <span>
            <b className="text-zinc-800">{liveCount}</b> on storefront
            {totalCount > 0 && (
              <>
                {' '}
                · <b className="text-zinc-800">{totalCount}</b> total
              </>
            )}
          </span>
          {!isAuto && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  bulkSetVisibility(
                    filteredProducts.map((p) => p.id),
                    true,
                  )
                }
                className="rounded px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              >
                Show filtered
              </button>
              <button
                type="button"
                onClick={() =>
                  bulkSetVisibility(
                    filteredProducts.map((p) => p.id),
                    false,
                  )
                }
                className="rounded px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              >
                Hide filtered
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Stats ---------------- */

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone: 'emerald' | 'zinc' | 'violet'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : tone === 'violet'
        ? 'bg-violet-50 text-violet-700 ring-violet-100'
        : 'bg-zinc-100 text-zinc-700 ring-zinc-200'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${toneClass}`}
        >
          {value}
        </span>
      </div>
      {hint && <p className="mt-2 text-[12px] text-zinc-500">{hint}</p>}
    </div>
  )
}

function AccentStat({
  color,
  onChange,
}: {
  color: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div
      ref={ref}
      className="relative rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_0_rgba(17,24,39,0.04)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-zinc-500">
          Accent
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="size-5 rounded-full ring-2 ring-white ring-offset-1 ring-offset-zinc-200 transition hover:ring-offset-zinc-400"
          style={{ backgroundColor: color }}
          aria-label="Change accent color"
        />
      </div>
      <p className="mt-2 font-mono text-[11.5px] uppercase text-zinc-500">
        {color}
      </p>
      {open && (
        <div className="absolute right-3 top-full z-20 mt-2 w-[230px] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_SWATCHES.map((s) => {
              const active = s.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange(s)}
                  className={`size-6 rounded-full transition ${
                    active
                      ? 'ring-2 ring-zinc-900 ring-offset-2'
                      : 'ring-1 ring-zinc-200 hover:ring-zinc-400'
                  }`}
                  style={{ backgroundColor: s }}
                  aria-label={`Use ${s}`}
                />
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1">
            <input
              type="color"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <input
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 bg-transparent font-mono text-[11.5px] uppercase text-zinc-700 outline-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Collections strip ---------------- */

function CollectionsStrip({
  collections,
  active,
  onActivate,
  onClear,
  onAdd,
  onRename,
  onRemove,
  onMove,
  countsById,
  totalProductCount,
}: {
  collections: Collection[]
  active: string | null
  onActivate: (id: string) => void
  onClear: () => void
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  countsById: Record<string, number>
  totalProductCount: number
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function commit() {
    if (name.trim()) onAdd(name)
    setName('')
    setAdding(false)
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-zinc-900">
            Collections
          </h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Tabs on the storefront — like “Bestsellers” or “New arrivals.”
            Optional.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <PlusIcon /> New
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onClear}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition ${
            active === null
              ? 'bg-zinc-900 text-white'
              : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
          }`}
        >
          All products
          <span className="text-[10.5px] opacity-70">{totalProductCount}</span>
        </button>

        {collections.map((cat, i) => {
          const isActive = active === cat.id
          const isEditing = editing === cat.id
          return (
            <div
              key={cat.id}
              className={`group inline-flex items-center overflow-hidden rounded-full text-[12px] font-medium transition ${
                isActive
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={cat.name}
                  onChange={(e) => onRename(cat.id, e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape')
                      setEditing(null)
                  }}
                  className="bg-transparent px-3 py-1 outline-none placeholder:text-current/60"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onActivate(cat.id)}
                  onDoubleClick={() => setEditing(cat.id)}
                  className="px-3 py-1"
                  title="Click to filter · double-click to rename"
                >
                  {cat.name}
                  <span className="ml-1.5 opacity-70">
                    {countsById[cat.id] ?? 0}
                  </span>
                </button>
              )}
              <div className="flex items-center pr-1.5 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onMove(cat.id, -1)}
                  disabled={i === 0}
                  aria-label="Move left"
                  className="rounded p-1 leading-none disabled:opacity-30 hover:bg-black/10"
                >
                  <CaretIcon dir="left" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(cat.id, 1)}
                  disabled={i === collections.length - 1}
                  aria-label="Move right"
                  className="rounded p-1 leading-none disabled:opacity-30 hover:bg-black/10"
                >
                  <CaretIcon dir="right" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(cat.id)}
                  aria-label="Rename"
                  className="rounded p-1 leading-none hover:bg-black/10"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(cat.id)}
                  aria-label="Remove"
                  className="rounded p-1 leading-none hover:bg-black/10"
                >
                  <XIcon />
                </button>
              </div>
            </div>
          )
        })}

        {adding && (
          <div className="inline-flex items-center overflow-hidden rounded-full bg-emerald-50 ring-1 ring-emerald-200">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit()
                }
                if (e.key === 'Escape') {
                  setAdding(false)
                  setName('')
                }
              }}
              onBlur={commit}
              placeholder="Collection name"
              className="bg-transparent px-3 py-1 text-[12px] text-emerald-900 placeholder:text-emerald-500 outline-none"
            />
          </div>
        )}

        {collections.length === 0 && !adding && (
          <span className="text-[11.5px] text-zinc-500">
            None yet · groups are optional
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------------- Product row ---------------- */

function ProductRow({
  product,
  visible,
  collections,
  returnHref,
  onToggleVisible,
  onToggleCollection,
}: {
  product: ProductItem
  visible: boolean
  collections: Collection[]
  returnHref: string
  onToggleVisible: (v: boolean) => void
  onToggleCollection: (catId: string) => void
}) {
  const inCollections = collections.filter((c) =>
    c.product_ids.includes(product.id),
  )
  const tone =
    product.status === 'published'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : product.status === 'archived'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-zinc-100 text-zinc-700 ring-zinc-200'

  const editHref = `/dashboard/business/products/${product.id}?from=${encodeURIComponent(returnHref)}`

  return (
    <li
      className={`group flex items-center gap-4 px-4 py-3 transition hover:bg-zinc-50/70 ${
        !visible ? 'opacity-60' : ''
      }`}
    >
      {/* Image */}
      <a
        href={editHref}
        title="Edit product"
        className="shrink-0"
      >
        {product.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.cover_image_url}
            alt=""
            className="size-11 rounded-lg border border-zinc-200 object-cover transition hover:border-zinc-300"
          />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-[12px] font-medium uppercase text-zinc-400 transition hover:border-zinc-300">
            {product.title.slice(0, 2)}
          </div>
        )}
      </a>

      {/* Title + summary + tags */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={editHref}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[13.5px] font-semibold text-zinc-900 hover:text-emerald-700 hover:underline"
          >
            {product.title}
          </a>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium capitalize ring-1 ring-inset ${tone}`}
          >
            <span className="size-1 rounded-full bg-current" />
            {product.status}
          </span>
        </div>
        {product.summary && (
          <p className="mt-0.5 max-w-2xl truncate text-[12px] text-zinc-500">
            {product.summary}
          </p>
        )}
        {(inCollections.length > 0 || collections.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {inCollections.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-700 ring-1 ring-inset ring-violet-100"
              >
                {c.name}
                <button
                  type="button"
                  onClick={() => onToggleCollection(c.id)}
                  aria-label={`Remove from ${c.name}`}
                  className="opacity-50 hover:opacity-100"
                >
                  <XIcon size={9} />
                </button>
              </span>
            ))}
            {collections.length > 0 && (
              <CollectionPicker
                collections={collections}
                productId={product.id}
                onToggle={onToggleCollection}
              />
            )}
          </div>
        )}
      </div>

      {/* Price */}
      <div className="hidden w-24 shrink-0 text-right tabular-nums text-[13px] text-zinc-700 sm:block">
        {product.price_label}
      </div>

      {/* Edit */}
      <a
        href={editHref}
        title="Edit product"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11.5px] font-medium text-zinc-600 opacity-0 transition hover:bg-zinc-50 hover:text-zinc-900 group-hover:opacity-100 focus:opacity-100"
      >
        <PencilIcon /> Edit
      </a>

      {/* Visibility toggle */}
      <Toggle
        on={visible}
        onChange={onToggleVisible}
        label={visible ? 'Showing' : 'Hidden'}
      />
    </li>
  )
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
      <span className="hidden text-[11.5px] font-medium text-zinc-600 sm:inline">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          on ? 'bg-emerald-600' : 'bg-zinc-300'
        }`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow transition ${
            on ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function CollectionPicker({
  collections,
  productId,
  onToggle,
}: {
  collections: Collection[]
  productId: string
  onToggle: (catId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        <PlusIcon size={9} /> tag
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto p-1">
            {collections.map((c) => {
              const has = c.product_ids.includes(productId)
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={has}
                    onChange={() => onToggle(c.id)}
                    className="size-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Empty / loading ---------------- */

function Loader() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-16 text-[13px] text-zinc-500">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-700" />
      Loading products…
    </div>
  )
}

function Empty() {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
        <BoxIcon />
      </div>
      <h3 className="text-[14.5px] font-semibold text-zinc-900">
        No products yet
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-zinc-500">
        Add products in the Business section to start building your storefront.
      </p>
      <button
        type="submit"
        formAction={createProduct}
        formNoValidate
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
      >
        <PlusIcon /> Add your first product
      </button>
    </div>
  )
}

/* ---------------- Icons ---------------- */

function SearchIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx={11} cy={11} r={7} />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function XIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
function CaretIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {dir === 'left' ? (
        <polygon points="15 6 9 12 15 18" />
      ) : (
        <polygon points="9 6 15 12 9 18" />
      )}
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="mt-0.5 shrink-0"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="mt-0.5 shrink-0"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
    </svg>
  )
}
function BoxIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  )
}
