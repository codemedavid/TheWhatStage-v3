import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import { fetchActionPages } from './_lib/queries'

export default async function ActionPagesIndex() {
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
            Action Pages
          </h1>
          <p className="mt-0.5 text-[13px] text-[#6B7280]">
            Public pages — forms, bookings, quizzes, sales, catalogs, listings —
            that the chatbot sends to leads as a clear next step.
          </p>
        </div>
        <Link
          href="/dashboard/action-pages/new"
          className="inline-flex items-center rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
        >
          New action page
        </Link>
      </header>

      <Suspense fallback={<ListFallback />}>
        <List />
      </Suspense>
    </div>
  )
}

function ListFallback() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-6 text-[13px] text-[#6B7280]">
      Loading…
    </div>
  )
}

async function List() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const pages = await fetchActionPages(supabase, user.id)
  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-10 text-center">
        <h2 className="text-[15px] font-semibold text-[#111827]">No action pages yet</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Create one to give your chatbot a clear, interactive next step to send leads.
        </p>
        <Link
          href="/dashboard/action-pages/new"
          className="mt-4 inline-flex items-center rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
        >
          Create your first
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <table className="min-w-full text-[13px]">
        <thead className="bg-[#F9FAFB] text-left text-[12px] font-semibold uppercase tracking-wide text-[#6B7280]">
          <tr>
            <th className="px-4 py-2.5">Title</th>
            <th className="px-4 py-2.5">Kind</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Submissions</th>
            <th className="px-4 py-2.5">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {pages.map((p) => (
            <tr key={p.id} className="hover:bg-[#FAFAFA]">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/action-pages/${p.id}`}
                  className="font-medium text-[#111827] hover:text-[#059669]"
                >
                  {p.title}
                </Link>
                <div className="mt-0.5 text-[12px] text-[#9CA3AF]">/a/{p.slug}</div>
              </td>
              <td className="px-4 py-3 text-[#374151]">
                {KIND_REGISTRY[p.kind].label}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={p.status} />
              </td>
              <td className="px-4 py-3 text-[#374151]">{p.submission_count}</td>
              <td className="px-4 py-3 text-[#6B7280]">
                {new Date(p.updated_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusPill({ status }: { status: 'draft' | 'published' | 'archived' }) {
  const map = {
    draft: ['#6B7280', '#F3F4F6'],
    published: ['#047857', 'rgba(5,150,105,0.1)'],
    archived: ['#92400E', '#FEF3C7'],
  } as const
  const [fg, bg] = map[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: fg, backgroundColor: bg }}
    >
      {status}
    </span>
  )
}
