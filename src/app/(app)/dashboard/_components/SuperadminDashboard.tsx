import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/get-session'
import { isAccountStatus, type AccountStatus } from '@/lib/auth/account-status'
import { UserRowActions } from './UserRowActions'

type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: 'user' | 'admin' | 'superadmin'
  status: AccountStatus
  created_at: string
}

const STATUS_SORT: Record<AccountStatus, number> = { pending: 0, active: 1, paused: 2 }

const statusBadgeClass: Record<AccountStatus, string> = {
  pending: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800',
  active: 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  paused: 'inline-flex rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700',
}

export default async function SuperadminDashboard({ userName }: { userName: string }) {
  const session = await getSession()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, status, created_at')
    .order('created_at', { ascending: false })

  const profiles = ((data ?? []) as Array<Omit<ProfileRow, 'status'> & { status: string }>)
    .map<ProfileRow>((p) => ({
      ...p,
      status: isAccountStatus(p.status) ? p.status : 'active',
    }))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status])

  const pendingCount = profiles.filter((p) => p.status === 'pending').length

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Superadmin · Users</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Welcome, {userName}. {profiles.length} user{profiles.length === 1 ? '' : 's'} total
          {pendingCount > 0 ? ` · ${pendingCount} awaiting approval` : ''}.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load users: {error.message}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const isSelf = session?.userId === p.id
                const isOtherSuperadmin = p.role === 'superadmin' && !isSelf
                return (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">{p.full_name}</td>
                    <td className="px-4 py-3 text-neutral-700">{p.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          p.role === 'superadmin'
                            ? 'inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700'
                            : p.role === 'admin'
                              ? 'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700'
                              : 'inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700'
                        }
                      >
                        {p.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass[p.status]}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf || isOtherSuperadmin ? (
                        <span className="text-xs text-neutral-400">—</span>
                      ) : (
                        <UserRowActions userId={p.id} status={p.status} />
                      )}
                    </td>
                  </tr>
                )
              })}
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
