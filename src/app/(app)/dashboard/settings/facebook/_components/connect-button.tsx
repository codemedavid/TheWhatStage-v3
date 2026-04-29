import Link from 'next/link'

function MetaLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M22 12.061C22 6.505 17.523 2 12 2S2 6.505 2 12.061c0 5.022 3.657 9.184 8.438 9.939v-7.03H7.898v-2.91h2.54V9.845c0-2.522 1.492-3.915 3.777-3.915 1.094 0 2.238.196 2.238.196v2.476h-1.26c-1.243 0-1.63.775-1.63 1.572v1.886h2.773l-.443 2.91h-2.33V22c4.78-.755 8.437-4.917 8.437-9.939Z" />
    </svg>
  )
}

export function ConnectButton() {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="relative isolate px-6 py-8 sm:px-8 sm:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-[#EFF6FF] via-white to-white"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 -z-10 h-56 w-56 rounded-full bg-[#1877F2]/10 blur-3xl"
        />

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#1877F2] text-white shadow-[0_6px_16px_rgba(24,119,242,0.35)]">
            <MetaLogo className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[#111827]">
              Connect Facebook
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[#4B5563]">
              Link the Facebook Pages you manage so WhatStage can pull
              messages, comments, and insights into your workspace.
            </p>
          </div>
        </div>

        <ul className="mt-6 space-y-2 text-[13px] text-[#374151]">
          <li className="flex items-start gap-2">
            <CheckIcon />
            <span>Read your list of managed Pages</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon />
            <span>Reply to comments and messages on connected Pages</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon />
            <span>Disconnect any time — we never post without you</span>
          </li>
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/api/auth/facebook/start"
            className="inline-flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2.5 text-[14px] font-semibold text-white shadow-[0_6px_16px_rgba(24,119,242,0.35)] transition-all hover:bg-[#0F65D6] hover:shadow-[0_8px_22px_rgba(24,119,242,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1877F2]"
          >
            <MetaLogo className="h-4 w-4" />
            Continue with Facebook
          </Link>
          <span className="text-[12px] text-[#6B7280]">
            You&apos;ll be redirected to facebook.com to approve access.
          </span>
        </div>
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="mt-[2px] h-4 w-4 shrink-0 text-[#059669]"
    >
      <path
        d="M4.5 10.5l3 3 8-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
