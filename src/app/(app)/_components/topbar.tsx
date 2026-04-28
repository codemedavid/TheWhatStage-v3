export function Topbar({ fullName }: { fullName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-6 py-3">
      <div className="text-[14px] text-[#6B7280]">Welcome back</div>
      <div className="flex items-center gap-4">
        <span className="text-[14px] font-medium text-[#111827]">
          {fullName || 'Account'}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-full border border-[#E5E7EB] px-4 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
