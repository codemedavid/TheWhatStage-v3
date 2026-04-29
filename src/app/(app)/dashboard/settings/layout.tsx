import { SettingsTabs } from './_components/settings-tabs'

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Manage your profile, integrations, and notifications.
        </p>
      </header>

      <SettingsTabs />

      <div className="pt-6">{children}</div>
    </div>
  )
}
