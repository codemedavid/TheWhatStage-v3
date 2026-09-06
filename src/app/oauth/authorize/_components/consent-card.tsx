import type { ApiKeyScope } from '@/lib/api-keys/resolve'
import type { RawAuthorizeParams } from '@/lib/oauth/authorize-request'
import { SCOPE_DESCRIPTIONS } from '@/lib/oauth/scopes'
import { approveAuthorization, denyAuthorization } from '../actions'
import { OAuthShell } from './shell'

interface ConsentCardProps {
  clientName: string
  redirectHost: string
  scopes: ApiKeyScope[]
  userEmail: string
  raw: RawAuthorizeParams
}

const APPROVE =
  'inline-flex w-full items-center justify-center rounded-full bg-[#C96442] px-6 py-[13px] text-[15px] font-medium text-[#FFF8F1] transition hover:bg-[#B5563A]'
const DENY =
  'inline-flex w-full items-center justify-center rounded-full border border-[#E5DFD0] bg-white px-6 py-[13px] text-[15px] font-medium text-[#3A3835] transition hover:bg-[#F5F1E8]'

function HiddenParams({ raw }: { raw: RawAuthorizeParams }) {
  return (
    <>
      {Object.entries(raw).map(([k, v]) =>
        typeof v === 'string' ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
    </>
  )
}

export function ConsentCard({ clientName, redirectHost, scopes, userEmail, raw }: ConsentCardProps) {
  return (
    <OAuthShell>
      <p className="mb-2 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.12em] text-[#C96442]">
        Connect an app
      </p>
      <h1 className="mb-3 font-[family-name:var(--font-instrument-serif)] text-[30px] leading-[1.1] tracking-[-0.02em]">
        <span className="italic">{clientName}</span> wants to use your WhatStage
      </h1>
      <p className="mb-6 text-[14px] leading-[1.55] text-[#6B6862]">
        Signed in as <span className="font-medium text-[#1F1E1D]">{userEmail}</span>. Approving lets this app act
        on your account until you disconnect it from Settings.
      </p>

      <ul className="mb-6 flex flex-col gap-2.5 rounded-xl bg-[#F5F1E8] p-4">
        {scopes.map((scope) => (
          <li key={scope} className="flex items-start gap-2.5 text-[13.5px] leading-[1.5] text-[#3A3835]">
            <span aria-hidden className="mt-[3px] text-[#C96442]">✦</span>
            {SCOPE_DESCRIPTIONS[scope]}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2.5">
        <form action={approveAuthorization}>
          <HiddenParams raw={raw} />
          <button type="submit" className={APPROVE}>Approve</button>
        </form>
        <form action={denyAuthorization}>
          <HiddenParams raw={raw} />
          <button type="submit" className={DENY}>Cancel</button>
        </form>
      </div>

      <p className="mt-5 text-center text-[12px] leading-[1.5] text-[#6B6862]">
        You&rsquo;ll be sent back to <span className="font-[family-name:var(--font-geist-mono)]">{redirectHost}</span>.
      </p>
    </OAuthShell>
  )
}
