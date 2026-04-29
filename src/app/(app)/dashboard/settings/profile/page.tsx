import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'

export default async function ProfileSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-[15px] font-semibold text-[#111827]">Profile</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Your name and email visible across the workspace.
        </p>

        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">
              Full name
            </dt>
            <dd className="mt-1 text-[14px] text-[#111827]">
              {session.fullName || <span className="text-[#9CA3AF]">—</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">
              Email
            </dt>
            <dd className="mt-1 text-[14px] text-[#111827]">{session.email}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">
              Role
            </dt>
            <dd className="mt-1 inline-flex items-center rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[12px] font-medium capitalize text-[#047857]">
              {session.role}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
