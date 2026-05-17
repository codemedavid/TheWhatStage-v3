import { createClient } from '@/lib/supabase/server'

type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: 'user' | 'admin' | 'superadmin'
  created_at: string
}

export default async function SuperadminDashboard({ userName }: { userName: string }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: false })

  const profiles = (data ?? []) as ProfileRow[]

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Superadmin · Users</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Welcome, {userName}. {profiles.length} user{profiles.length === 1 ? '' : 's'} total.
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
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
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
                  <td className="px-4 py-3 text-neutral-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {profiles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
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
