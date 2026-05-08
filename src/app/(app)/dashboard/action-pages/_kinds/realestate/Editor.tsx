'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { KindEditorProps } from '../types'
import {
  defaultRealestateConfig,
  defaultRealestateProperty,
  parseRealestateConfig,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  type RealestateConfig,
  type RealestateBrand,
  type RealestateGroup,
  type RealestateGalleryItem,
  type RealestateCustomField,
  type RealestateFinancingOption,
  type RealestateProperty,
  type PropertyStatus,
  type PropertyType,
} from '@/app/a/[slug]/_kinds/realestate/schema'
import { buildMapEmbedUrl } from '@/lib/action-pages/maps'

interface LinkablePage {
  id: string
  title: string
  slug: string
  kind: string
  status: string
}

const STATUS_LABELS: Record<PropertyStatus, string> = {
  for_sale: 'For sale',
  for_rent: 'For rent',
  sold: 'Sold',
  reserved: 'Reserved',
  draft: 'Draft',
}

const STATUS_TONE: Record<PropertyStatus, string> = {
  for_sale: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  for_rent: 'bg-blue-50 text-blue-700 ring-blue-200',
  sold: 'bg-rose-50 text-rose-700 ring-rose-200',
  reserved: 'bg-amber-50 text-amber-700 ring-amber-200',
  draft: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  condo: 'Condo',
  townhouse: 'Townhouse',
  lot: 'Lot',
  commercial: 'Commercial',
  other: 'Other',
}

const KIND_PILL: Record<string, { bg: string; text: string; label: string }> = {
  form: { bg: '#F5F3FF', text: '#6D28D9', label: 'Form' },
  booking: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Booking' },
  qualification: { bg: '#FFFBEB', text: '#B45309', label: 'Qualification' },
}

const PRESET_SWATCHES = [
  '#0F766E',
  '#059669',
  '#5C6AC4',
  '#DE3618',
  '#F49342',
  '#9C6ADE',
  '#0EA5E9',
  '#111827',
]

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

type StatusFilter = 'all' | PropertyStatus

export default function RealEstateEditor({ page }: KindEditorProps) {
  const initial = useMemo<RealestateConfig>(
    () => parseRealestateConfig(page.config),
    [page.config],
  )

  const [config, setConfig] = useState<RealestateConfig>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const editingProperty = useMemo(
    () => config.properties.find((p) => p.id === editingId) ?? null,
    [config.properties, editingId],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return config.properties.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (activeGroup) {
        const grp = config.groups.find((g) => g.id === activeGroup)
        if (!grp || !grp.property_ids.includes(p.id)) return false
      }
      if (!q) return true
      const blob = [
        p.title,
        p.address.line1,
        p.address.line2,
        p.address.city,
        p.address.region,
        p.description,
        p.price.display_label,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [config.properties, config.groups, search, statusFilter, activeGroup])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: config.properties.length,
      for_sale: 0,
      for_rent: 0,
      sold: 0,
      reserved: 0,
      draft: 0,
    }
    for (const p of config.properties) c[p.status] += 1
    return c
  }, [config.properties])

  function addProperty() {
    const next = defaultRealestateProperty('Untitled property')
    setConfig((c) => ({ ...c, properties: [...c.properties, next] }))
    setEditingId(next.id)
  }

  function updateProperty(id: string, patch: Partial<RealestateProperty>) {
    setConfig((c) => ({
      ...c,
      properties: c.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function removeProperty(id: string) {
    setConfig((c) => ({
      ...c,
      properties: c.properties.filter((p) => p.id !== id),
    }))
    if (editingId === id) setEditingId(null)
  }

  function duplicateProperty(id: string) {
    setConfig((c) => {
      const idx = c.properties.findIndex((p) => p.id === id)
      if (idx < 0) return c
      const original = c.properties[idx]!
      const copy: RealestateProperty = {
        ...original,
        id: genId(),
        title: original.title ? `${original.title} (copy)` : 'Untitled property',
        gallery: original.gallery.map((g) => ({ ...g, id: genId() })),
        custom_specs: original.custom_specs.map((f) => ({ ...f, id: genId() })),
        financing_options: original.financing_options.map((o) => ({
          ...o,
          id: genId(),
        })),
      }
      const next = [...c.properties]
      next.splice(idx + 1, 0, copy)
      return { ...c, properties: next }
    })
  }

  function moveProperty(id: string, dir: -1 | 1) {
    setConfig((c) => {
      const idx = c.properties.findIndex((p) => p.id === id)
      if (idx < 0) return c
      const next = idx + dir
      if (next < 0 || next >= c.properties.length) return c
      const arr = [...c.properties]
      ;[arr[idx], arr[next]] = [arr[next]!, arr[idx]!]
      return { ...c, properties: arr }
    })
  }

  function addGroup(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = genId()
    setConfig((c) => ({
      ...c,
      groups: [...c.groups, { id, name: trimmed, property_ids: [] }],
    }))
  }

  function renameGroup(id: string, name: string) {
    setConfig((c) => ({
      ...c,
      groups: c.groups.map((g) => (g.id === id ? { ...g, name } : g)),
    }))
  }

  function removeGroup(id: string) {
    setConfig((c) => ({
      ...c,
      groups: c.groups.filter((g) => g.id !== id),
    }))
    if (activeGroup === id) setActiveGroup(null)
  }

  function moveGroup(id: string, dir: -1 | 1) {
    setConfig((c) => {
      const idx = c.groups.findIndex((g) => g.id === id)
      if (idx < 0) return c
      const next = idx + dir
      if (next < 0 || next >= c.groups.length) return c
      const arr = [...c.groups]
      ;[arr[idx], arr[next]] = [arr[next]!, arr[idx]!]
      return { ...c, groups: arr }
    })
  }

  function togglePropertyInGroup(groupId: string, propertyId: string) {
    setConfig((c) => ({
      ...c,
      groups: c.groups.map((g) => {
        if (g.id !== groupId) return g
        const has = g.property_ids.includes(propertyId)
        return {
          ...g,
          property_ids: has
            ? g.property_ids.filter((x) => x !== propertyId)
            : [...g.property_ids, propertyId],
        }
      }),
    }))
  }

  return (
    <div className="space-y-5">
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      {editingProperty ? (
        <PropertyEditor
          property={editingProperty}
          pageId={page.id}
          groups={config.groups}
          onClose={() => setEditingId(null)}
          onChange={(patch) => updateProperty(editingProperty.id, patch)}
          onRemove={() => removeProperty(editingProperty.id)}
          onToggleGroup={(gId) => togglePropertyInGroup(gId, editingProperty.id)}
        />
      ) : (
        <ListView
          page={page}
          config={config}
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          activeGroup={activeGroup}
          setActiveGroup={setActiveGroup}
          counts={counts}
          filtered={filtered}
          setConfig={setConfig}
          addProperty={addProperty}
          addGroup={addGroup}
          renameGroup={renameGroup}
          removeGroup={removeGroup}
          moveGroup={moveGroup}
          duplicateProperty={duplicateProperty}
          moveProperty={moveProperty}
          removeProperty={removeProperty}
          togglePropertyInGroup={togglePropertyInGroup}
          setEditingId={setEditingId}
        />
      )}
    </div>
  )
}

interface ListViewProps {
  page: KindEditorProps['page']
  config: RealestateConfig
  search: string
  setSearch: (v: string) => void
  statusFilter: StatusFilter
  setStatusFilter: (v: StatusFilter) => void
  activeGroup: string | null
  setActiveGroup: (v: string | null) => void
  counts: Record<StatusFilter, number>
  filtered: RealestateProperty[]
  setConfig: React.Dispatch<React.SetStateAction<RealestateConfig>>
  addProperty: () => void
  addGroup: (name: string) => void
  renameGroup: (id: string, name: string) => void
  removeGroup: (id: string) => void
  moveGroup: (id: string, dir: -1 | 1) => void
  duplicateProperty: (id: string) => void
  moveProperty: (id: string, dir: -1 | 1) => void
  removeProperty: (id: string) => void
  togglePropertyInGroup: (groupId: string, propertyId: string) => void
  setEditingId: (id: string | null) => void
}

function ListView({
  page,
  config,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  activeGroup,
  setActiveGroup,
  counts,
  filtered,
  setConfig,
  addProperty,
  addGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  duplicateProperty,
  moveProperty,
  removeProperty,
  togglePropertyInGroup,
  setEditingId,
}: ListViewProps) {
  return (
    <>
      {/* Brand / agency identity */}
      <BrandSection
        brand={config.brand}
        bg={config.theme.background_color}
        buttonText={config.theme.button_text_color}
        onChange={(b) => setConfig((c) => ({ ...c, brand: b }))}
        onBgChange={(v) =>
          setConfig((c) => ({ ...c, theme: { ...c.theme, background_color: v } }))
        }
        onButtonTextChange={(v) =>
          setConfig((c) => ({ ...c, theme: { ...c.theme, button_text_color: v } }))
        }
      />

      {/* Stat bar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Properties" value={counts.all} tone="emerald" hint="In this listing page" />
        <Stat
          label="For sale"
          value={counts.for_sale}
          tone="zinc"
          hint={`${counts.for_rent} for rent`}
        />
        <Stat
          label="Reserved · sold"
          value={counts.reserved + counts.sold}
          tone="violet"
          hint={`${counts.draft} drafts`}
        />
        <AccentStat
          color={config.theme.accent_color}
          onChange={(v) =>
            setConfig((c) => ({ ...c, theme: { ...c.theme, accent_color: v } }))
          }
        />
      </div>

      {/* Groups strip */}
      <GroupsStrip
        groups={config.groups}
        active={activeGroup}
        onActivate={(id) => setActiveGroup(id)}
        onClear={() => setActiveGroup(null)}
        onAdd={addGroup}
        onRename={renameGroup}
        onRemove={removeGroup}
        onMove={moveGroup}
        countsById={Object.fromEntries(
          config.groups.map((g) => [g.id, g.property_ids.length]),
        )}
        totalPropertyCount={config.properties.length}
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
                placeholder="Search properties"
                className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="inline-flex shrink-0 rounded-md border border-zinc-200 bg-white p-0.5 text-[12px] font-medium">
              {(
                [
                  { v: 'all' as StatusFilter, l: 'All' },
                  { v: 'for_sale' as StatusFilter, l: 'For sale' },
                  { v: 'for_rent' as StatusFilter, l: 'For rent' },
                  { v: 'sold' as StatusFilter, l: 'Sold' },
                  { v: 'draft' as StatusFilter, l: 'Drafts' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setStatusFilter(opt.v)}
                  className={`rounded px-2.5 py-1 transition ${
                    statusFilter === opt.v
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {opt.l}
                  <span className="ml-1 opacity-70">{counts[opt.v]}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={addProperty}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <PlusIcon /> Add property
          </button>
        </div>

        {/* Body */}
        {config.properties.length === 0 ? (
          <Empty onAdd={addProperty} />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center text-[13px] text-zinc-500">
            No properties match{' '}
            {search ? (
              <>
                &ldquo;<b className="text-zinc-700">{search}</b>&rdquo;
              </>
            ) : (
              'this filter'
            )}
            .
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((property, i) => (
              <PropertyRow
                key={property.id}
                property={property}
                index={config.properties.findIndex((p) => p.id === property.id)}
                total={config.properties.length}
                groups={config.groups}
                onEdit={() => setEditingId(property.id)}
                onRemove={() => removeProperty(property.id)}
                onDuplicate={() => duplicateProperty(property.id)}
                onMove={(dir) => moveProperty(property.id, dir)}
                onToggleGroup={(gId) => togglePropertyInGroup(gId, property.id)}
                disableMove={search.length > 0 || statusFilter !== 'all' || i < 0}
              />
            ))}
          </ul>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 text-[11.5px] text-zinc-500">
          <span>
            <b className="text-zinc-800">{config.properties.length}</b>{' '}
            {config.properties.length === 1 ? 'property' : 'properties'}
          </span>
          <span className="text-zinc-400">Click a row to edit details →</span>
        </div>
      </div>

      <LinkedPagesCard
        currentPageId={page.id}
        linkedIds={config.linked_action_page_ids}
        onChange={(ids) =>
          setConfig((c) => ({ ...c, linked_action_page_ids: ids }))
        }
      />
    </>
  )
}

/* ────────────────────────── Brand section ────────────────────────── */

function BrandSection({
  brand,
  bg,
  buttonText,
  onChange,
  onBgChange,
  onButtonTextChange,
}: {
  brand: RealestateBrand
  bg: string
  buttonText: string
  onChange: (b: RealestateBrand) => void
  onBgChange: (v: string) => void
  onButtonTextChange: (v: string) => void
}) {
  const initials = brand.name.trim()
    ? brand.name.trim().slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-zinc-900">Agency identity</h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Agency name and description shown on your public listing page.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ColorMini label="Background" value={bg} onChange={onBgChange} />
          <ColorMini label="Button text" value={buttonText} onChange={onButtonTextChange} />
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Logo preview */}
          <div className="shrink-0">
            <div
              className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm"
              title="Logo preview"
            >
              {brand.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.logo_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <span className="text-[18px] font-semibold text-zinc-400">
                  {initials}
                </span>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldInput
                label="Agency / developer name"
                value={brand.name}
                onChange={(v) => onChange({ ...brand, name: v })}
                placeholder="e.g. Northhaven Realty"
              />
              <FieldInput
                label="Tagline"
                value={brand.tagline}
                onChange={(v) => onChange({ ...brand, tagline: v })}
                placeholder="e.g. Find your dream home"
              />
            </div>

            <div>
              <label className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">
                Description
              </label>
              <textarea
                value={brand.description}
                onChange={(e) => onChange({ ...brand, description: e.target.value })}
                rows={2}
                placeholder="A short blurb shown on the listing page about your agency."
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <FieldInput
              label="Logo URL"
              value={brand.logo_url}
              onChange={(v) => onChange({ ...brand, logo_url: v })}
              placeholder="https://… (paste image URL)"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── Groups strip ────────────────────────── */

function GroupsStrip({
  groups,
  active,
  onActivate,
  onClear,
  onAdd,
  onRename,
  onRemove,
  onMove,
  countsById,
  totalPropertyCount,
}: {
  groups: RealestateGroup[]
  active: string | null
  onActivate: (id: string) => void
  onClear: () => void
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  countsById: Record<string, number>
  totalPropertyCount: number
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
            Groups
          </h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Tabs on the listing — like &ldquo;Makati&rdquo; or &ldquo;BGC.&rdquo; Optional.
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
          All properties
          <span className="text-[10.5px] opacity-70">{totalPropertyCount}</span>
        </button>

        {groups.map((grp, i) => {
          const isActive = active === grp.id
          const isEditing = editing === grp.id
          return (
            <div
              key={grp.id}
              className={`group inline-flex items-center overflow-hidden rounded-full text-[12px] font-medium transition ${
                isActive
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={grp.name}
                  onChange={(e) => onRename(grp.id, e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') setEditing(null)
                  }}
                  className="bg-transparent px-3 py-1 outline-none placeholder:text-current/60"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onActivate(grp.id)}
                  onDoubleClick={() => setEditing(grp.id)}
                  className="px-3 py-1"
                  title="Click to filter · double-click to rename"
                >
                  {grp.name}
                  <span className="ml-1.5 opacity-70">
                    {countsById[grp.id] ?? 0}
                  </span>
                </button>
              )}
              <div className="flex items-center pr-1.5 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onMove(grp.id, -1)}
                  disabled={i === 0}
                  aria-label="Move left"
                  className="rounded p-1 leading-none disabled:opacity-30 hover:bg-black/10"
                >
                  <CaretIcon dir="left" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(grp.id, 1)}
                  disabled={i === groups.length - 1}
                  aria-label="Move right"
                  className="rounded p-1 leading-none disabled:opacity-30 hover:bg-black/10"
                >
                  <CaretIcon dir="right" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(grp.id)}
                  aria-label="Rename"
                  className="rounded p-1 leading-none hover:bg-black/10"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(grp.id)}
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
              placeholder="Group name"
              className="bg-transparent px-3 py-1 text-[12px] text-emerald-900 placeholder:text-emerald-500 outline-none"
            />
          </div>
        )}

        {groups.length === 0 && !adding && (
          <span className="text-[11.5px] text-zinc-500">
            None yet · groups are optional
          </span>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────── Property row ────────────────────────── */

function PropertyRow({
  property,
  index,
  total,
  groups,
  onEdit,
  onRemove,
  onDuplicate,
  onMove,
  onToggleGroup,
  disableMove,
}: {
  property: RealestateProperty
  index: number
  total: number
  groups: RealestateGroup[]
  onEdit: () => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (dir: -1 | 1) => void
  onToggleGroup: (groupId: string) => void
  disableMove: boolean
}) {
  const cover =
    property.gallery.find((g) => g.primary) ??
    [...property.gallery].sort((a, b) => a.position - b.position)[0] ??
    null
  const priceLabel = formatPriceShort(property.price)
  const addressLine = [property.address.line1, property.address.city]
    .filter(Boolean)
    .join(', ')

  const inGroups = groups.filter((g) => g.property_ids.includes(property.id))

  return (
    <li className="group flex items-center gap-4 px-4 py-3 transition hover:bg-zinc-50/70">
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0"
        title="Edit property"
        aria-label={`Edit ${property.title || 'property'}`}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt={cover.alt || property.title || 'Property'}
            className="size-11 rounded-lg border border-zinc-200 object-cover transition group-hover:border-zinc-300"
          />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-zinc-400">
            <HouseIcon />
          </div>
        )}
      </button>

      {/* Title + address + tags */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="truncate text-[13.5px] font-semibold text-zinc-900 hover:text-emerald-700"
          >
            {property.title || 'Untitled property'}
          </button>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium capitalize ring-1 ring-inset ${STATUS_TONE[property.status]}`}
          >
            <span className="size-1 rounded-full bg-current" />
            {STATUS_LABELS[property.status]}
          </span>
        </div>
        {addressLine && (
          <p className="mt-0.5 max-w-2xl truncate text-[12px] text-zinc-500">
            {addressLine}
          </p>
        )}
        {(inGroups.length > 0 || groups.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {inGroups.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-700 ring-1 ring-inset ring-violet-100"
              >
                {g.name}
                <button
                  type="button"
                  onClick={() => onToggleGroup(g.id)}
                  aria-label={`Remove from ${g.name}`}
                  className="opacity-50 hover:opacity-100"
                >
                  <XIcon size={9} />
                </button>
              </span>
            ))}
            {groups.length > 0 && (
              <GroupPicker
                groups={groups}
                propertyId={property.id}
                onToggle={onToggleGroup}
              />
            )}
          </div>
        )}
      </div>

      {/* Price */}
      <div className="hidden w-28 shrink-0 text-right tabular-nums text-[13px] font-medium text-zinc-700 sm:block">
        {priceLabel || <span className="text-zinc-400">—</span>}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <IconButton
          title="Move up"
          onClick={() => onMove(-1)}
          disabled={disableMove || index <= 0}
        >
          <CaretIcon dir="up" />
        </IconButton>
        <IconButton
          title="Move down"
          onClick={() => onMove(1)}
          disabled={disableMove || index >= total - 1}
        >
          <CaretIcon dir="down" />
        </IconButton>
        <IconButton title="Duplicate" onClick={onDuplicate}>
          <CopyIcon />
        </IconButton>
        <IconButton
          title="Remove"
          onClick={() => {
            if (confirm('Remove this property?')) onRemove()
          }}
          danger
        >
          <TrashIcon />
        </IconButton>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11.5px] font-medium text-zinc-600 opacity-0 transition hover:bg-zinc-50 hover:text-zinc-900 group-hover:opacity-100 focus:opacity-100"
      >
        <PencilIcon /> Edit
      </button>
    </li>
  )
}

function GroupPicker({
  groups,
  propertyId,
  onToggle,
}: {
  groups: RealestateGroup[]
  propertyId: string
  onToggle: (groupId: string) => void
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
        <PlusIcon size={9} /> group
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto p-1">
            {groups.map((g) => {
              const has = g.property_ids.includes(propertyId)
              return (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-zinc-800 hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={has}
                    onChange={() => onToggle(g.id)}
                    className="size-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="flex-1 truncate">{g.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function IconButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1.5 leading-none transition disabled:opacity-30 ${
        danger
          ? 'text-zinc-400 hover:bg-rose-50 hover:text-rose-600'
          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}

/* ────────────────────────── Linked pages card ────────────────────────── */

function LinkedPagesCard({
  currentPageId,
  linkedIds,
  onChange,
}: {
  currentPageId: string
  linkedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [pages, setPages] = useState<LinkablePage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/action-pages/list?kinds=form,booking,qualification&exclude=${currentPageId}`,
      { cache: 'no-store' },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setPages(body.pages as LinkablePage[])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed_to_load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentPageId])

  const linkedSet = new Set(linkedIds)
  const linked: LinkablePage[] = []
  const available: LinkablePage[] = []
  for (const p of pages ?? []) {
    if (linkedSet.has(p.id)) linked.push(p)
    else available.push(p)
  }
  linked.sort((a, b) => linkedIds.indexOf(a.id) - linkedIds.indexOf(b.id))

  function attach(id: string) {
    if (linkedSet.has(id)) return
    onChange([...linkedIds, id])
  }
  function detach(id: string) {
    onChange(linkedIds.filter((x) => x !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const idx = linkedIds.indexOf(id)
    if (idx < 0) return
    const next = [...linkedIds]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap]!, next[idx]!]
    onChange(next)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-zinc-900">
            Action pages
          </h3>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Forms, bookings, or qualifications shown on each property detail
            page. Submissions get tagged with the chosen property.
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        {loading && <p className="text-[12px] text-zinc-500">Loading…</p>}
        {error && <p className="text-[12px] text-rose-600">{error}</p>}

        {linked.length > 0 && (
          <div className="mb-3 space-y-1.5">
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">
              Attached
            </h4>
            {linked.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2"
              >
                <KindPill kind={p.kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-zinc-900">
                    {p.title}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">/a/{p.slug}</div>
                </div>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={() => move(p.id, -1)}
                    disabled={idx === 0}
                    className="rounded-l-md border border-zinc-200 bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(p.id, 1)}
                    disabled={idx === linked.length - 1}
                    className="-ml-px rounded-r-md border border-zinc-200 bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                  >
                    ↓
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => detach(p.id)}
                  className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                >
                  Detach
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500">
            Available
          </h4>
          {available.length === 0 ? (
            <p className="text-[12px] text-zinc-500">
              {pages === null
                ? '—'
                : 'No more pages to attach. Create a form, booking, or qualification page first.'}
            </p>
          ) : (
            available.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2"
              >
                <KindPill kind={p.kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-900">
                    {p.title}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">/a/{p.slug}</div>
                </div>
                <span
                  className={`text-[11px] ${
                    p.status === 'published' ? 'text-emerald-600' : 'text-zinc-400'
                  }`}
                >
                  {p.status}
                </span>
                <button
                  type="button"
                  onClick={() => attach(p.id)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Attach
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function KindPill({ kind }: { kind: string }) {
  const meta = KIND_PILL[kind] ?? { bg: '#F3F4F6', text: '#6B7280', label: kind }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.text }}
    >
      {meta.label}
    </span>
  )
}

/* ────────────────────────── Stats / accent ────────────────────────── */

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
      <p className="mt-2 font-mono text-[11.5px] uppercase text-zinc-500">{color}</p>
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

/* ────────────────────────── Color mini ────────────────────────── */

function ColorMini({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11.5px] text-zinc-600">
      {label}
      <span className="relative inline-flex">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded-md border border-zinc-200 bg-white"
        />
      </span>
    </label>
  )
}

/* ────────────────────────── Field input ────────────────────────── */

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </div>
  )
}

/* ────────────────────────── Empty ────────────────────────── */

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
        <HouseIcon size={20} />
      </div>
      <h3 className="text-[14.5px] font-semibold text-zinc-900">
        No properties yet
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-zinc-500">
        Add the first property to start building this listing page. You can add
        more later, each with its own gallery and details.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
      >
        <PlusIcon /> Add your first property
      </button>
    </div>
  )
}

/* ────────────────────────── Property editor ────────────────────────── */


function ple_readiness(property: RealestateProperty) {
  const checks = [
    { label: 'Title & status', done: property.title.trim().length > 0 },
    {
      label: 'Price set',
      done:
        property.price.amount !== null ||
        property.price.display_label.trim() !== '',
    },
    {
      label: 'Cover photo',
      done:
        property.gallery.some((g) => g.primary) || property.gallery.length > 0,
    },
    {
      label: 'Address (for map)',
      done:
        property.address.line1.trim() !== '' &&
        property.address.city.trim() !== '',
    },
    { label: 'Description', done: property.description.trim().length > 50 },
    { label: 'Floor area', done: property.specs.floor_area !== null },
  ]
  const done = checks.filter((c) => c.done).length
  return { checks, done, total: checks.length, pct: Math.round((done / checks.length) * 100) }
}

function PleSection({
  num,
  icon,
  title,
  description,
  children,
  danger,
}: {
  num: string
  icon: string
  title: string
  description: string
  children: React.ReactNode
  danger?: boolean
}) {
  const borderColor = danger ? '#E8C9C4' : '#E8E6DE'
  const dividerColor = danger ? '#EDD3CE' : '#E8E6DE'
  return (
    <div
      className="mb-4 overflow-hidden rounded-[14px] bg-white"
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div
        className="grid items-center gap-3.5 px-5 py-[18px]"
        style={{
          gridTemplateColumns: '36px 1fr auto',
          borderBottom: `1px solid ${dividerColor}`,
        }}
      >
        <div
          className="grid h-9 w-9 place-items-center rounded-[10px] text-lg"
          style={{
            fontFamily: 'var(--font-instrument-serif)',
            background: danger ? '#FBEBE7' : '#F6F5F1',
            border: `1px solid ${borderColor}`,
            color: danger ? '#B23A2B' : '#0F4A30',
          }}
        >
          {icon}
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-[#1A1915]">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-[#6B6960]">{description}</p>
        </div>
        <div
          className="text-[11px] tracking-[0.08em] text-[#9C9A90]"
          style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
        >
          {num} / 06
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function PropertyEditor({
  property,
  pageId,
  groups,
  onClose,
  onChange,
  onRemove,
  onToggleGroup,
}: {
  property: RealestateProperty
  pageId: string
  groups: RealestateGroup[]
  onClose: () => void
  onChange: (patch: Partial<RealestateProperty>) => void
  onRemove: () => void
  onToggleGroup: (groupId: string) => void
}) {
  const { checks, done, total, pct } = ple_readiness(property)

  const coverImg = [...property.gallery]
    .sort((a, b) => a.position - b.position)
    .find((g) => g.primary) ?? property.gallery[0] ?? null

  const priceLabel =
    property.price.display_label.trim() ||
    (property.price.amount !== null
      ? `${property.price.currency} ${property.price.amount.toLocaleString()}`
      : null)

  const specParts = [
    property.specs.beds !== null ? `${property.specs.beds} bd` : null,
    property.specs.baths !== null ? `${property.specs.baths} ba` : null,
    property.specs.floor_area !== null
      ? `${property.specs.floor_area.value} ${property.specs.floor_area.unit}`
      : null,
  ].filter(Boolean)

  return (
    <div className="pb-16">
      {/* ── Hero ── */}
      <div className="mb-7">
        <button
          type="button"
          onClick={onClose}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[#6B6960] hover:bg-[#F6F5F1] hover:text-[#1A1915]"
        >
          <CaretIcon dir="left" /> Back to properties
        </button>
        <div
          className="text-[11px] uppercase tracking-[0.12em] text-[#9C9A90]"
          style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
        >
          Property · {STATUS_LABELS[property.status]}
        </div>
        <input
          autoFocus
          value={property.title}
          onChange={(e) => onChange({ title: e.target.value.slice(0, 160) })}
          placeholder="e.g. 3-BR Townhouse in Quezon City"
          className="mt-1.5 w-full bg-transparent text-[40px] leading-tight tracking-[-0.02em] text-[#1A1915] outline-none placeholder:italic placeholder:text-[#9C9A90]"
          style={{ fontFamily: 'var(--font-instrument-serif)' }}
        />
        <p className="mt-2 max-w-xl text-[14px] text-[#6B6960]">
          Add photos, set the price, and describe what makes this place special
          — buyers see this on the public listing page.
        </p>
      </div>

      {/* ── Two-column grid ── */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_336px]">

        {/* ── Main column ── */}
        <div>
          {/* 01 Photos */}
          <PleSection
            num="01"
            icon="▤"
            title="Photos"
            description="Drag the primary image to use it as the cover. JPEG, PNG, or WebP up to 5 MB."
          >
            <GalleryTab
              pageId={pageId}
              gallery={property.gallery}
              onChange={(gallery) => onChange({ gallery })}
            />
          </PleSection>

          {/* 02 Status & price */}
          <PleSection
            num="02"
            icon="$"
            title="Status & price"
            description="Shown on the property card and detail page."
          >
            <BasicsTab property={property} onChange={onChange} />
          </PleSection>

          {/* 03 Location & description */}
          <PleSection
            num="03"
            icon="◎"
            title="Location & description"
            description="Address powers the map embed. Description appears on the detail page."
          >
            <LocationTab
              address={property.address}
              onChange={(address) => onChange({ address })}
              description={property.description}
              onDescriptionChange={(description) => onChange({ description })}
            />
          </PleSection>

          {/* 04 Specs & amenities */}
          <PleSection
            num="04"
            icon="◫"
            title="Specs & amenities"
            description="Common attributes buyers compare, plus your custom fields."
          >
            <DetailsTab property={property} onChange={onChange} />
          </PleSection>

          {/* 05 Financing */}
          <PleSection
            num="05"
            icon="⌘"
            title="Financing"
            description="Comparable rows for buyers (e.g. cash, bank, in-house)."
          >
            <FinancingTab
              options={property.financing_options}
              notes={property.financing_notes}
              currency={property.price.currency}
              onOptionsChange={(financing_options) =>
                onChange({ financing_options })
              }
              onNotesChange={(financing_notes) => onChange({ financing_notes })}
            />
          </PleSection>

          {/* 06 Danger zone */}
          <PleSection
            num="06"
            icon="!"
            title="Danger zone"
            description="Removing this property is permanent for this listing page."
            danger
          >
            <div
              className="rounded-[12px] p-4"
              style={{
                background: '#FBEBE7',
                border: '1px solid #F2D1CB',
              }}
            >
              <h4 className="text-[13px] font-semibold text-[#B23A2B]">
                Remove property
              </h4>
              <p className="mt-1 mb-3 text-[12.5px] text-[#3F3D36]">
                This deletes the property, its photos, and any submissions
                linked to it. Cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Remove this property?')) {
                    onRemove()
                    onClose()
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#B23A2B] hover:bg-[#B23A2B] hover:text-white"
                style={{ borderColor: '#B23A2B' }}
              >
                <TrashIcon /> Remove property
              </button>
            </div>
          </PleSection>
        </div>

        {/* ── Sidebar ── */}
        <aside className="sticky top-20 flex flex-col gap-4">
          {/* Card preview */}
          <div
            className="rounded-[14px] border border-[#E8E6DE] bg-white p-4"
          >
            <h4
              className="mb-2.5 text-[11px] uppercase tracking-[0.06em] text-[#6B6960]"
              style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
            >
              Card preview
            </h4>
            <div
              className="relative overflow-hidden rounded-[12px] p-4 text-white"
              style={{
                background: coverImg
                  ? `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.55)), url(${coverImg.url}) center/cover`
                  : 'linear-gradient(135deg, #1B3A8A, #E5A654)',
              }}
            >
              <div
                className="mb-2 inline-block rounded bg-black/40 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em]"
                style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
              >
                {STATUS_LABELS[property.status].toUpperCase()}
              </div>
              <div
                className="text-[22px] leading-tight"
                style={{ fontFamily: 'var(--font-instrument-serif)' }}
              >
                {property.title || 'Untitled property'}
              </div>
              {specParts.length > 0 && (
                <div className="mt-1 text-[12px] opacity-85">
                  {specParts.join(' · ')}
                </div>
              )}
              {priceLabel && (
                <div
                  className="mt-3.5 text-[28px] leading-none"
                  style={{ fontFamily: 'var(--font-instrument-serif)' }}
                >
                  {priceLabel}
                </div>
              )}
            </div>
          </div>

          {/* Readiness */}
          <div className="rounded-[14px] border border-[#E8E6DE] bg-white p-4">
            <h4
              className="mb-2.5 text-[11px] uppercase tracking-[0.06em] text-[#6B6960]"
              style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
            >
              Listing readiness
            </h4>
            <div
              className="mb-1.5 h-1.5 overflow-hidden rounded-full"
              style={{ background: '#EFEEE8' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #1F7A4D, #2EA86A)',
                }}
              />
            </div>
            <div className="mb-3.5 flex justify-between text-[12px] text-[#6B6960]">
              <span>
                <strong className="text-[#1A1915]">{pct}%</strong> complete
              </span>
              <span>
                {done} of {total} fields
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className="flex items-center gap-2 text-[13px]"
                  style={{ color: c.done ? '#3F3D36' : '#9C9A90' }}
                >
                  <span
                    className="text-[12px]"
                    style={{ color: c.done ? '#1F7A4D' : '#9C9A90' }}
                  >
                    {c.done ? '✓' : '○'}
                  </span>
                  {c.label}
                </li>
              ))}
            </ul>
          </div>

          {/* Groups */}
          {groups.length > 0 && (
            <div className="rounded-[14px] border border-[#E8E6DE] bg-white p-4">
              <h4
                className="mb-2.5 text-[11px] uppercase tracking-[0.06em] text-[#6B6960]"
                style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
              >
                Groups
              </h4>
              <div className="flex flex-col gap-0.5">
                {groups.map((g) => {
                  const checked = g.property_ids.includes(property.id)
                  return (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-[#3F3D36] hover:bg-[#F6F5F1]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleGroup(g.id)}
                        className="size-3.5 rounded border-[#D9D6CC] text-[#1F7A4D] focus:ring-[#1F7A4D]"
                      />
                      <span className="flex-1 truncate">{g.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/* ────────────────────────── Basics tab ────────────────────────── */

function BasicsTab({
  property,
  onChange,
}: {
  property: RealestateProperty
  onChange: (patch: Partial<RealestateProperty>) => void
}) {
  return (
    <div className="space-y-4">
      <SubHeader
        title="Listing basics"
        help="Status and price shown on the property card and detail page."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField<PropertyStatus>
          label="Status"
          value={property.status}
          options={PROPERTY_STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABELS[s],
          }))}
          onChange={(v) => onChange({ status: v })}
        />
        <TextField
          label="Display price label"
          placeholder="e.g. Starts at ₱4.5M"
          value={property.price.display_label}
          onChange={(v) =>
            onChange({ price: { ...property.price, display_label: v } })
          }
        />
        <NumberField
          label="Price amount"
          value={property.price.amount}
          allowNull
          onChange={(v) =>
            onChange({ price: { ...property.price, amount: v } })
          }
        />
        <TextField
          label="Currency"
          value={property.price.currency}
          maxLength={8}
          onChange={(v) =>
            onChange({
              price: { ...property.price, currency: v.toUpperCase() },
            })
          }
        />
        <SelectField<'monthly' | 'yearly' | ''>
          label="Price period"
          value={(property.price.period ?? '') as 'monthly' | 'yearly' | ''}
          options={[
            { value: '', label: 'One-time' },
            { value: 'monthly', label: 'Per month' },
            { value: 'yearly', label: 'Per year' },
          ]}
          onChange={(v) =>
            onChange({
              price: { ...property.price, period: v === '' ? null : v },
            })
          }
        />
      </div>
    </div>
  )
}

/* ────────────────────────── Gallery tab ────────────────────────── */

function GalleryTab({
  pageId,
  gallery,
  onChange,
}: {
  pageId: string
  gallery: RealestateGalleryItem[]
  onChange: (g: RealestateGalleryItem[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const next: RealestateGalleryItem[] = [...gallery]
      let pos = next.length === 0 ? 0 : Math.max(...next.map((g) => g.position)) + 1
      const startEmpty = next.length === 0
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/action-pages/${pageId}/images`, {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `upload_failed_${res.status}`)
        }
        const { url, fileId } = (await res.json()) as { url: string; fileId: string }
        next.push({
          id: genId(),
          fileId,
          url,
          alt: '',
          position: pos++,
          primary: startEmpty && next.length === 0,
        })
      }
      if (!next.some((g) => g.primary) && next.length > 0) next[0]!.primary = true
      onChange(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const sorted = [...gallery].sort((a, b) => a.position - b.position)

  function setPrimary(id: string) {
    onChange(gallery.map((g) => ({ ...g, primary: g.id === id })))
  }
  function remove(id: string) {
    onChange(gallery.filter((g) => g.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const arr = [...gallery].sort((a, b) => a.position - b.position)
    const idx = arr.findIndex((g) => g.id === id)
    if (idx < 0) return
    const swap = idx + dir
    if (swap < 0 || swap >= arr.length) return
    const a = arr[idx]!
    const b = arr[swap]!
    const aPos = a.position
    a.position = b.position
    b.position = aPos
    onChange([...arr])
  }
  function setAlt(id: string, alt: string) {
    onChange(gallery.map((g) => (g.id === id ? { ...g, alt } : g)))
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && (
        <p className="mb-2 text-[12px] text-[#B23A2B]">{error}</p>
      )}

      <div className="grid grid-cols-4 gap-3">
        {sorted.map((g, idx) => (
          <div key={g.id} className="group relative">
            {/* Tile */}
            <div
              className="relative aspect-square overflow-hidden rounded-[10px] cursor-pointer"
              style={{
                border: g.primary
                  ? '2px solid #1F7A4D'
                  : '1px solid #D9D6CC',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.url}
                alt={g.alt || 'Property image'}
                className="h-full w-full object-cover"
              />
              {g.primary && (
                <span
                  className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white"
                  style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}
                >
                  COVER
                </span>
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                {!g.primary && (
                  <button
                    type="button"
                    onClick={() => setPrimary(g.id)}
                    className="rounded bg-white/90 px-2 py-1 text-[10.5px] font-semibold text-[#1A1915] hover:bg-white"
                  >
                    Set cover
                  </button>
                )}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(g.id, -1)}
                    disabled={idx === 0}
                    className="rounded bg-white/80 px-1.5 py-1 text-[10px] text-[#1A1915] disabled:opacity-40 hover:bg-white"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(g.id, 1)}
                    disabled={idx === sorted.length - 1}
                    className="rounded bg-white/80 px-1.5 py-1 text-[10px] text-[#1A1915] disabled:opacity-40 hover:bg-white"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(g.id)}
                    className="rounded bg-[#B23A2B]/90 px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-[#B23A2B]"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
            {/* Alt text (below tile) */}
            <input
              type="text"
              placeholder="Alt text"
              value={g.alt ?? ''}
              onChange={(e) => setAlt(g.id, e.target.value.slice(0, 200))}
              className="mt-1.5 w-full rounded-lg border border-[#E8E6DE] bg-white px-2 py-1 text-[11px] text-[#3F3D36] placeholder:text-[#9C9A90] focus:border-[#1F7A4D] focus:outline-none"
            />
          </div>
        ))}

        {/* Upload tile */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: '#D9D6CC',
            background: '#F6F5F1',
            color: '#6B6960',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#1F7A4D'
            e.currentTarget.style.background = '#F2F8F4'
            e.currentTarget.style.color = '#0F4A30'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#D9D6CC'
            e.currentTarget.style.background = '#F6F5F1'
            e.currentTarget.style.color = '#6B6960'
          }}
        >
          <span className="text-2xl leading-none">+</span>
          <span>{uploading ? 'Uploading…' : 'Upload images'}</span>
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[12px] text-[#9C9A90]">
        <span>
          <strong className="text-[#3F3D36]">{sorted.length}</strong> photos ·
          hover to reorder or set cover
        </span>
        <span>5 MB max each</span>
      </div>
    </div>
  )
}

/* ────────────────────────── Location tab ────────────────────────── */

function LocationTab({
  address,
  onChange,
  description,
  onDescriptionChange,
}: {
  address: RealestateProperty['address']
  onChange: (a: RealestateProperty['address']) => void
  description: string
  onDescriptionChange: (v: string) => void
}) {
  const embedUrl = buildMapEmbedUrl(address)
  const update = (patch: Partial<RealestateProperty['address']>) =>
    onChange({ ...address, ...patch })

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SubHeader
          title="Address"
          help="Used to render a Google Maps embed on the public page."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Address line 1"
            value={address.line1}
            onChange={(v) => update({ line1: v })}
            placeholder="123 Mabuhay St."
          />
          <TextField
            label="Address line 2"
            value={address.line2}
            onChange={(v) => update({ line2: v })}
            placeholder="Subdivision / unit"
          />
          <TextField label="City" value={address.city} onChange={(v) => update({ city: v })} />
          <TextField
            label="Region / state"
            value={address.region}
            onChange={(v) => update({ region: v })}
          />
          <TextField
            label="Postal code"
            value={address.postal}
            onChange={(v) => update({ postal: v })}
          />
          <TextField
            label="Country"
            value={address.country}
            onChange={(v) => update({ country: v })}
            placeholder="Philippines"
          />
        </div>
        {embedUrl ? (
          <div className="overflow-hidden rounded-md border border-zinc-200">
            <iframe
              src={embedUrl}
              width="100%"
              height="200"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              className="block"
            />
          </div>
        ) : (
          <p className="text-[12px] text-zinc-500">
            Fill in the address to see a map preview.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <SubHeader
          title="Description"
          help="Free-form text shown on the property detail page. Line breaks preserved."
        />
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value.slice(0, 8000))}
          rows={6}
          maxLength={8000}
          placeholder="Tell buyers what makes this property special — neighborhood, layout, finishes, what's nearby."
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[14px]"
        />
        <p className="text-[11px] text-zinc-400">{description.length}/8000</p>
      </div>
    </div>
  )
}

/* ────────────────────────── Details tab ────────────────────────── */

function DetailsTab({
  property,
  onChange,
}: {
  property: RealestateProperty
  onChange: (patch: Partial<RealestateProperty>) => void
}) {
  const specs = property.specs

  const updateSpecs = (patch: Partial<typeof specs>) =>
    onChange({ specs: { ...specs, ...patch } })

  const addCustom = () =>
    onChange({
      custom_specs: [
        ...property.custom_specs,
        { id: genId(), label: 'New field', value: '' } as RealestateCustomField,
      ],
    })
  const updateCustom = (id: string, patch: Partial<RealestateCustomField>) =>
    onChange({
      custom_specs: property.custom_specs.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    })
  const removeCustom = (id: string) =>
    onChange({ custom_specs: property.custom_specs.filter((f) => f.id !== id) })

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SubHeader title="Specs" help="Common attributes buyers compare." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectField<PropertyType | ''>
            label="Property type"
            value={(specs.property_type ?? '') as PropertyType | ''}
            options={[
              { value: '', label: '—' },
              ...PROPERTY_TYPES.map((t) => ({
                value: t,
                label: PROPERTY_TYPE_LABELS[t],
              })),
            ]}
            onChange={(v) => updateSpecs({ property_type: v === '' ? null : v })}
          />
          <NumberField
            label="Bedrooms"
            value={specs.beds}
            allowNull
            onChange={(v) => updateSpecs({ beds: v === null ? null : Math.round(v) })}
          />
          <NumberField
            label="Bathrooms"
            value={specs.baths}
            allowNull
            onChange={(v) => updateSpecs({ baths: v })}
          />
          <NumberField
            label="Year built"
            value={specs.year_built}
            allowNull
            onChange={(v) => updateSpecs({ year_built: v === null ? null : Math.round(v) })}
          />
          <NumberField
            label="Parking spots"
            value={specs.parking}
            allowNull
            onChange={(v) => updateSpecs({ parking: v === null ? null : Math.round(v) })}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AreaField
            label="Floor area"
            value={specs.floor_area}
            onChange={(v) => updateSpecs({ floor_area: v })}
          />
          <AreaField
            label="Lot area"
            value={specs.lot_area}
            onChange={(v) => updateSpecs({ lot_area: v })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SubHeader title="Custom fields" help='Add things like "HOA dues" or "Title status".' />
        {property.custom_specs.length === 0 && (
          <p className="text-[12px] text-zinc-500">No custom fields yet.</p>
        )}
        <div className="space-y-2">
          {property.custom_specs.map((f) => (
            <div key={f.id} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <input
                  type="text"
                  value={f.label}
                  onChange={(e) =>
                    updateCustom(f.id, { label: e.target.value.slice(0, 80) })
                  }
                  placeholder="Label"
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                />
              </div>
              <div className="sm:col-span-7">
                <input
                  type="text"
                  value={f.value}
                  onChange={(e) =>
                    updateCustom(f.id, { value: e.target.value.slice(0, 500) })
                  }
                  placeholder="Value"
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]"
                />
              </div>
              <div className="flex items-center sm:col-span-1">
                <button
                  type="button"
                  onClick={() => removeCustom(f.id)}
                  className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[12px] font-medium text-rose-600 hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addCustom}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            + Add custom field
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <SubHeader
          title="Amenities"
          help="Pills shown on the public page (e.g. Pool, Gated, Furnished)."
        />
        <AmenitiesEditor
          amenities={property.amenities}
          onChange={(amenities) => onChange({ amenities })}
        />
      </div>
    </div>
  )
}

function AmenitiesEditor({
  amenities,
  onChange,
}: {
  amenities: string[]
  onChange: (a: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  function add() {
    const v = draft.trim()
    if (!v) return
    if (amenities.includes(v)) {
      setDraft('')
      return
    }
    onChange([...amenities, v.slice(0, 60)])
    setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {amenities.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[12px] text-zinc-700"
          >
            {a}
            <button
              type="button"
              onClick={() => onChange(amenities.filter((x) => x !== a))}
              className="text-zinc-400 hover:text-rose-600"
              aria-label={`Remove ${a}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Add amenity (press Enter)"
          maxLength={60}
          className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function AreaField({
  label,
  value,
  onChange,
}: {
  label: string
  value: { value: number; unit: 'sqm' | 'sqft' } | null
  onChange: (v: { value: number; unit: 'sqm' | 'sqft' } | null) => void
}) {
  const v = value?.value ?? null
  const unit = value?.unit ?? 'sqm'
  return (
    <div className="space-y-1">
      <span className="block text-[11.5px] font-medium text-zinc-600">{label}</span>
      <div className="flex gap-2">
        <input
          type="number"
          value={v ?? ''}
          min={0}
          step="any"
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(null)
            const n = Number(raw)
            if (!Number.isFinite(n)) return
            onChange({ value: n, unit })
          }}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]"
          placeholder="0"
        />
        <select
          value={unit}
          onChange={(e) => {
            if (v === null) return
            onChange({ value: v, unit: e.target.value as 'sqm' | 'sqft' })
          }}
          className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-[12.5px]"
        >
          <option value="sqm">sqm</option>
          <option value="sqft">sqft</option>
        </select>
      </div>
    </div>
  )
}

/* ────────────────────────── Financing tab ────────────────────────── */

function FinancingTab({
  options,
  notes,
  currency,
  onOptionsChange,
  onNotesChange,
}: {
  options: RealestateFinancingOption[]
  notes: string
  currency: string
  onOptionsChange: (o: RealestateFinancingOption[]) => void
  onNotesChange: (n: string) => void
}) {
  function add() {
    onOptionsChange([
      ...options,
      {
        id: genId(),
        label: 'New financing option',
        down_payment_amount: null,
        down_payment_percent: null,
        term_months: null,
        monthly_amount: null,
        currency,
        notes: '',
      },
    ])
  }
  function update(id: string, patch: Partial<RealestateFinancingOption>) {
    onOptionsChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }
  function remove(id: string) {
    onOptionsChange(options.filter((o) => o.id !== id))
  }

  return (
    <div className="space-y-4">
      <SubHeader
        title="Financing options"
        help="Comparable rows for buyers (e.g. cash, bank, in-house)."
      />
      <div className="space-y-3">
        {options.length === 0 && (
          <p className="text-[12px] text-zinc-500">No options yet.</p>
        )}
        {options.map((o) => (
          <div key={o.id} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <TextField
                  label="Option name"
                  value={o.label}
                  onChange={(v) => update(o.id, { label: v.slice(0, 80) })}
                  placeholder="Bank financing"
                />
              </div>
              <div className="sm:col-span-3">
                <NumberField
                  label="Down payment %"
                  value={o.down_payment_percent}
                  allowNull
                  onChange={(v) => update(o.id, { down_payment_percent: v })}
                />
              </div>
              <div className="sm:col-span-4">
                <NumberField
                  label="Down payment amount"
                  value={o.down_payment_amount}
                  allowNull
                  onChange={(v) => update(o.id, { down_payment_amount: v })}
                />
              </div>
              <div className="sm:col-span-3">
                <NumberField
                  label="Term (months)"
                  value={o.term_months}
                  allowNull
                  onChange={(v) =>
                    update(o.id, { term_months: v === null ? null : Math.round(v) })
                  }
                />
              </div>
              <div className="sm:col-span-3">
                <NumberField
                  label="Monthly amount"
                  value={o.monthly_amount}
                  allowNull
                  onChange={(v) => update(o.id, { monthly_amount: v })}
                />
              </div>
              <div className="sm:col-span-2">
                <TextField
                  label="Currency"
                  value={o.currency}
                  onChange={(v) =>
                    update(o.id, { currency: v.toUpperCase().slice(0, 8) })
                  }
                />
              </div>
              <div className="sm:col-span-12">
                <TextField
                  label="Notes"
                  value={o.notes ?? ''}
                  onChange={(v) => update(o.id, { notes: v.slice(0, 500) })}
                  placeholder="20% reservation, 10% spot DP, balance via bank…"
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => remove(o.id)}
                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11.5px] font-medium text-rose-600 hover:bg-rose-50"
              >
                Remove option
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
        >
          + Add financing option
        </button>
      </div>

      <div className="space-y-2">
        <span className="block text-[11.5px] font-medium text-zinc-600">
          Financing notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value.slice(0, 4000))}
          rows={3}
          maxLength={4000}
          placeholder="Free-form caveats, disclaimers, lender contact info…"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13.5px]"
        />
      </div>
    </div>
  )
}

/* ────────────────────────── Shared sub-components ────────────────────────── */

function SubHeader({ title, help }: { title: string; help?: string }) {
  return (
    <div>
      <h4 className="text-[12.5px] font-semibold text-zinc-900">{title}</h4>
      {help && <p className="mt-0.5 text-[11.5px] text-zinc-500">{help}</p>}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-zinc-600">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13.5px]"
      />
    </label>
  )
}

function fmtNum(n: number): string {
  const [int, dec] = n.toString().split('.')
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec !== undefined ? `${grouped}.${dec}` : grouped
}

function NumberField({
  label,
  value,
  onChange,
  allowNull,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  allowNull?: boolean
}) {
  // null = not focused; string = user is actively editing
  const [raw, setRaw] = useState<string | null>(null)

  const displayed =
    raw !== null
      ? raw
      : value !== null && Number.isFinite(value)
        ? fmtNum(value)
        : ''

  function handleFocus() {
    setRaw(value !== null && Number.isFinite(value) ? fmtNum(value) : '')
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const r = e.target.value.replace(/[^\d.,\-]/g, '')
    setRaw(r)
    const stripped = r.replace(/,/g, '')
    if (stripped === '' || stripped === '-') {
      onChange(allowNull ? null : 0)
      return
    }
    const n = Number(stripped)
    if (Number.isFinite(n)) onChange(n)
  }

  function handleBlur() {
    const stripped = (raw ?? '').replace(/,/g, '')
    const n = Number(stripped)
    if (stripped !== '' && Number.isFinite(n)) onChange(n)
    setRaw(null)
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-zinc-600">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={displayed}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13.5px]"
      />
    </label>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-zinc-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13.5px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ────────────────────────── Formatting ────────────────────────── */

function formatPriceShort(price: RealestateProperty['price']): string {
  if (price.display_label) return price.display_label
  if (price.amount === null || !Number.isFinite(price.amount)) return ''
  let base: string
  try {
    base = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: price.currency,
      maximumFractionDigits: 0,
    }).format(price.amount)
  } catch {
    base = `${price.amount.toLocaleString()} ${price.currency}`
  }
  if (price.period === 'monthly') return `${base}/mo`
  if (price.period === 'yearly') return `${base}/yr`
  return base
}

void defaultRealestateConfig

/* ────────────────────────── Icons ────────────────────────── */

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
function XIcon({ size = 12 }: { size?: number }) {
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
function CaretIcon({ dir }: { dir: 'left' | 'right' | 'up' | 'down' }) {
  const points =
    dir === 'left'
      ? '15 6 9 12 15 18'
      : dir === 'right'
        ? '9 6 15 12 9 18'
        : dir === 'up'
          ? '6 15 12 9 18 15'
          : '6 9 12 15 18 9'
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points={points} />
    </svg>
  )
}
function CopyIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x={9} y={9} width={11} height={11} rx={2} />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  )
}
function HouseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" />
      <path d="M9 21V12h6v9" />
    </svg>
  )
}
