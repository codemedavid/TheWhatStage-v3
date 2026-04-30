'use client'

import { useState } from 'react'

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-[#E5E7EB]">
      <input
        readOnly
        value={value}
        aria-label={label ?? 'value'}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 bg-[#F9FAFB] px-3 py-2 font-mono text-[12px] text-[#111827] focus:outline-none"
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            /* noop */
          }
        }}
        className="border-l border-[#E5E7EB] bg-white px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#F3F4F6]"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
