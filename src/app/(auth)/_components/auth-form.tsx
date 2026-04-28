'use client'

import { useFormStatus } from 'react-dom'

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  error,
  defaultValue,
}: {
  label: string
  name: string
  type?: string
  autoComplete?: string
  error?: string
  defaultValue?: string
}) {
  return (
    <label className="block">
      <span className="block text-[14px] font-medium text-[#111827] mb-1.5">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? 'true' : 'false'}
        className="block w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[14px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#34D399] focus:outline-none focus:ring-2 focus:ring-[#34D399]/30"
      />
      {error ? (
        <span className="mt-1 block text-[12px] text-[#DC2626]">{error}</span>
      ) : null}
    </label>
  )
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-[#059669] px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#047857] disabled:opacity-60"
    >
      {pending ? 'Please wait…' : children}
    </button>
  )
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-[#FEE2E2] bg-[#FEE2E2]/40 px-3 py-2 text-[13px] text-[#DC2626]"
    >
      {message}
    </div>
  )
}
