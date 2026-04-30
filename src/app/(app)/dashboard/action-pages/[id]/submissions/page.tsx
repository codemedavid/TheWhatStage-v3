import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchActionPage, fetchSubmissions } from '../../_lib/queries'

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const page = await fetchActionPage(supabase, user.id, id)
  if (!page) notFound()
  const submissions = await fetchSubmissions(supabase, user.id, id)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link
          href={`/dashboard/action-pages/${page.id}`}
          className="text-[12px] text-[#6B7280] hover:text-[#111827]"
        >
          ← Back to editor
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#111827]">
          {page.title} — Submissions
        </h1>
      </header>

      {submissions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-10 text-center text-[13px] text-[#6B7280]">
          No submissions yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
          <table className="min-w-full text-[13px]">
            <thead className="bg-[#F9FAFB] text-left text-[12px] font-semibold uppercase tracking-wide text-[#6B7280]">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Lead</th>
                <th className="px-4 py-2.5">PSID</th>
                <th className="px-4 py-2.5">Outcome</th>
                <th className="px-4 py-2.5">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {submissions.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {s.lead_id ? (
                      <Link
                        href={`/dashboard/leads?lead=${s.lead_id}`}
                        className="font-medium text-[#111827] hover:text-[#059669]"
                      >
                        {s.lead_name ?? s.lead_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-[#9CA3AF]">— anonymous —</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">
                    {s.psid ? s.psid.slice(-10) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[#374151]">{s.outcome ?? '—'}</td>
                  <td className="px-4 py-3">
                    <pre className="max-w-md overflow-x-auto rounded bg-[#F9FAFB] p-2 font-mono text-[11px] text-[#374151]">
                      {JSON.stringify(s.data, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
