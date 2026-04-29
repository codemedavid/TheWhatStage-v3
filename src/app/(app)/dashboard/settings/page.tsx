import Link from 'next/link'

export default function SettingsPage() {
  return (
    <div className="p-8">
      <h1 className="text-[20px] font-semibold text-[#111827] mb-4">Settings</h1>
      <ul className="space-y-2">
        <li>
          <Link
            href="/dashboard/settings/facebook"
            className="text-[14px] font-medium text-[#059669] hover:underline"
          >
            Facebook
          </Link>
        </li>
      </ul>
    </div>
  )
}
