import Link from 'next/link'
import { ApprovalPoller } from '../_components/ApprovalPoller'

export const metadata = {
  title: 'Account paused · WhatStage',
}

export default function AccountPausedPage() {
  return (
    <div className="flex flex-col">
      <ApprovalPoller />
      <h1 className="mb-2.5 font-[family-name:var(--font-instrument-serif)] text-[clamp(34px,3.6vw,44px)] font-normal leading-[1.1] tracking-[-0.02em]">
        Account <em className="italic text-[#C96442]">paused.</em>
      </h1>
      <p className="mb-6 text-[15px] leading-[1.55] text-[#6B6862]">
        Sign-in is currently disabled for this account, and your Messenger bot
        is not replying. Message the WhatStage team to resolve this.
      </p>

      <div className="rounded-2xl border border-[#E5DFD0] bg-white px-5 py-4 text-[14px] leading-[1.5] text-[#3A3835]">
        <p className="mb-1.5 font-medium text-[#1F1E1D]">Your data is safe</p>
        <p className="text-[13.5px] text-[#6B6862]">
          We haven&rsquo;t deleted anything — leads, chats, and configuration
          are preserved. Once the pause is lifted you&rsquo;ll be able to sign
          in and the bot will resume right where it left off.
        </p>
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
