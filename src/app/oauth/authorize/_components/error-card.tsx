import { OAuthShell } from './shell'

export function ErrorCard({ message }: { message: string }) {
  return (
    <OAuthShell>
      <h1 className="mb-3 font-[family-name:var(--font-instrument-serif)] text-[30px] leading-[1.1] tracking-[-0.02em]">
        Can&rsquo;t connect this app
      </h1>
      <p className="text-[14.5px] leading-[1.55] text-[#6B6862]">{message}</p>
      <p className="mt-4 text-[13px] leading-[1.55] text-[#6B6862]">
        Go back to the app that sent you here and try connecting again. If it keeps failing, remove
        the WhatStage connector from that app and add it fresh.
      </p>
    </OAuthShell>
  )
}
