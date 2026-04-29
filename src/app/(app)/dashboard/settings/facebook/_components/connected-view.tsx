import { disconnectForm } from '../actions'

type Page = {
  id: string
  fb_page_id: string
  name: string
  category: string | null
}

export function ConnectedView({ pages }: { pages: Page[] }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
            Connected Facebook pages
          </h2>
          <p className="text-[13px] text-[#6B7280]">
            {pages.length} page{pages.length === 1 ? '' : 's'} connected.
          </p>
        </div>
        <form action={disconnectForm}>
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Disconnect
          </button>
        </form>
      </div>
      <ul className="divide-y divide-[#E5E7EB]">
        {pages.map((p) => (
          <li key={p.id} className="py-3">
            <div className="text-[14px] font-medium text-[#111827]">{p.name}</div>
            {p.category && (
              <div className="text-[12px] text-[#6B7280]">{p.category}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
