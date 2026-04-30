'use client'

import type { KindEditorProps } from '../types'

export default function FormEditor({ page }: KindEditorProps) {
  // Stub — replaced by the Form kind PR.
  return (
    <>
      <input
        type="hidden"
        name="config"
        value={JSON.stringify(page.config ?? {})}
      />
      <ComingSoon kind="Form" />
    </>
  )
}

function ComingSoon({ kind }: { kind: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-6 text-center text-[13px] text-[#6B7280]">
      The {kind} editor is being built.
    </div>
  )
}
