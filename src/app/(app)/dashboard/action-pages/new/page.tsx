import Link from 'next/link'
import { ACTION_PAGE_KINDS, KIND_REGISTRY } from '@/lib/action-pages/kinds'
import { createActionPage } from '../actions/crud'

export default async function NewActionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          href="/dashboard/action-pages"
          className="text-[12px] text-[#6B7280] hover:text-[#111827]"
        >
          ← Back to action pages
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#111827]">
          New action page
        </h1>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          Pick a kind. You can edit the title, slug, and configuration after.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error}
          {detail ? ` — ${detail}` : null}
        </div>
      )}

      <form action={createActionPage} className="space-y-5">
        <div>
          <label
            htmlFor="title"
            className="block text-[12px] font-semibold text-[#374151]"
          >
            Title
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={120}
            placeholder="e.g. Book a discovery call"
            className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[rgba(5,150,105,0.15)]"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-semibold text-[#374151]">Kind</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ACTION_PAGE_KINDS.map((id, idx) => {
              const meta = KIND_REGISTRY[id]
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-[#E5E7EB] bg-white p-3 hover:border-[#059669] has-[:checked]:border-[#059669] has-[:checked]:bg-[rgba(5,150,105,0.04)]"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={id}
                    defaultChecked={idx === 0}
                    className="mt-0.5"
                    required
                  />
                  <span>
                    <span className="block text-[13px] font-semibold text-[#111827]">
                      {meta.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-[#6B7280]">
                      {meta.blurb}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Link
            href="/dashboard/action-pages"
            className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
