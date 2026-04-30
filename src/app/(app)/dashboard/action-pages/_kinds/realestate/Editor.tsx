'use client'

import type { KindEditorProps } from '../types'

export default function RealEstateEditor({ page }: KindEditorProps) {
  return (
    <>
      <input
        type="hidden"
        name="config"
        value={JSON.stringify(page.config ?? {})}
      />
      <div className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-6 text-center text-[13px] text-[#6B7280]">
        Real Estate pages are scheduled after the Store feature lands.
      </div>
    </>
  )
}
