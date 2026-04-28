'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useUrlState } from './_useUrlState'
import { LeadDrawer } from './LeadDrawer'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow } from '../_lib/queries'

export function Toolbar({
  params, stages, fieldDefs,
}: {
  params: LeadsQuery
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
}) {
  const { set } = useUrlState()
  const [q, setQ] = useState(params.q ?? '')
  const [openAdd, setOpenAdd] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => set({ q: q || undefined }), 300)
    return () => clearTimeout(t)
  }, [q, set])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, email, phone, company"
        className="border border-[#E5E7EB] rounded-md px-3 py-1.5 text-sm w-72"
      />
      <input
        type="date"
        value={params.from ?? ''}
        onChange={(e) => set({ from: e.target.value || undefined })}
        className="border rounded-md px-2 py-1.5 text-sm"
      />
      <span className="text-sm text-[#6B7280]">to</span>
      <input
        type="date"
        value={params.to ?? ''}
        onChange={(e) => set({ to: e.target.value || undefined })}
        className="border rounded-md px-2 py-1.5 text-sm"
      />
      <select
        value={params.sort}
        onChange={(e) => set({ sort: e.target.value })}
        className="border rounded-md px-2 py-1.5 text-sm"
      >
        <option value="recent">Recent</option>
        <option value="oldest">Oldest</option>
        <option value="name_asc">Name A–Z</option>
        <option value="value_desc">Value high–low</option>
      </select>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/dashboard/leads/stages" className="px-3 py-1.5 text-sm border rounded-md">
          Manage stages
        </Link>
        <Link href="/dashboard/leads/fields" className="px-3 py-1.5 text-sm border rounded-md">
          Custom fields
        </Link>
        <button
          onClick={() => setOpenAdd(true)}
          className="px-3 py-1.5 text-sm bg-[#059669] text-white rounded-md"
        >
          Add Lead
        </button>
      </div>
      {openAdd && (
        <LeadDrawer
          mode="create"
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={() => setOpenAdd(false)}
        />
      )}
    </div>
  )
}
