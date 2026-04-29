import type { FacebookPage } from '@/lib/facebook/oauth'
import { savePagesForm, disconnectForm } from '../actions'

export function PagePicker({ pages }: { pages: FacebookPage[] }) {
  if (pages.length === 0) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-[16px] font-semibold text-[#111827] mb-2">
          No pages found
        </h2>
        <p className="text-[13px] text-[#6B7280] mb-4">
          Your Facebook account doesn&apos;t manage any pages.
        </p>
        <form action={disconnectForm}>
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Disconnect
          </button>
        </form>
      </div>
    )
  }

  return (
    <form
      action={savePagesForm}
      className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
        Pick pages to track
      </h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Select one or more pages to connect.
      </p>
      <ul className="space-y-2 mb-4">
        {pages.map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              name="page_id"
              value={p.id}
              id={`pg-${p.id}`}
              className="h-4 w-4 rounded border-[#D1D5DB]"
            />
            <label htmlFor={`pg-${p.id}`} className="text-[14px] text-[#111827]">
              {p.name}
              {p.category && (
                <span className="ml-2 text-[12px] text-[#6B7280]">{p.category}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        className="inline-flex items-center rounded-md bg-[#059669] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#047857]"
      >
        Save pages
      </button>
    </form>
  )
}
