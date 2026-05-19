import Link from 'next/link'
import { ApprovalPoller } from '../_components/ApprovalPoller'

export const metadata = {
  title: 'Awaiting approval · WhatStage',
}

export default function AccountPendingPage() {
  return (
    <div className="flex flex-col">
      <ApprovalPoller />
      <h1 className="mb-2.5 font-[family-name:var(--font-instrument-serif)] text-[clamp(34px,3.6vw,44px)] font-normal leading-[1.1] tracking-[-0.02em]">
        Almost <em className="italic text-[#C96442]">there.</em>
      </h1>
      <p className="mb-6 text-[15px] leading-[1.55] text-[#6B6862]">
        Your account was created and is waiting for the WhatStage team to
        approve it. We&rsquo;ll let you know by email as soon as you&rsquo;re
        in.
      </p>

      <div className="rounded-2xl border border-[#E5DFD0] bg-white px-5 py-4 text-[14px] leading-[1.5] text-[#3A3835]">
        <p className="mb-1.5 font-medium text-[#1F1E1D]">What happens next</p>
        <ul className="list-disc pl-5 text-[13.5px] text-[#6B6862]">
          <li>An admin reviews new signups within a business day.</li>
          <li>Once approved, sign in with the same email and password.</li>
          <li>Need help right now? Message the team using the link below.</li>
        </ul>
      </div>

      <p className="mt-7 text-center text-[13.5px] text-[#6B6862]">
        Wrong account?{' '}
        <Link
          href="/login"
          className="font-medium text-[#C96442] hover:underline"
        >
          Back to sign in →
        </Link>
      </p>
    </div>
  )
}
