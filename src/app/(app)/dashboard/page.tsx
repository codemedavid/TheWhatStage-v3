import { getSession } from '@/lib/auth/get-session'

export default async function DashboardPage() {
  const session = await getSession()
  const name = session?.fullName ?? 'there'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Dashboard</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          Hi {name}, this is your workspace overview.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {['Activity', 'Pipeline', 'Messages'].map((title) => (
          <section
            key={title}
            className="rounded-xl border border-[#E5E7EB] bg-white p-5 min-h-40"
          >
            <h2 className="text-[14px] font-medium text-[#6B7280]">{title}</h2>
            <p className="mt-2 text-[13px] text-[#9CA3AF]">No data yet.</p>
          </section>
        ))}
      </div>
    </div>
  )
}
