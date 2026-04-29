import Link from 'next/link'

export function ConnectButton() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-6">
      <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
        Connect Facebook
      </h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Connect your Facebook account to link the pages you manage.
      </p>
      <Link
        href="/api/auth/facebook/start"
        className="inline-flex items-center rounded-md bg-[#1877F2] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#0F65D6]"
      >
        Connect Facebook
      </Link>
    </div>
  )
}
