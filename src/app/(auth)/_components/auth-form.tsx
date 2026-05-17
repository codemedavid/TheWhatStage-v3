'use client'

import { useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type FieldProps = {
  label: string
  name: string
  type?: string
  autoComplete?: string
  error?: string
  defaultValue?: string
  placeholder?: string
  icon?: ReactNode
  trailing?: ReactNode
  id?: string
  required?: boolean
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  error,
  defaultValue,
  placeholder,
  icon,
  trailing,
  id,
  required = true,
}: FieldProps) {
  const inputId = id ?? `auth-${name}`
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[13px] font-medium tracking-[-0.005em] text-[#3A3835]"
      >
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-4 top-1/2 grid -translate-y-1/2 place-items-center text-[#A19F98]">
            {icon}
          </span>
        ) : null}
        <input
          id={inputId}
          name={name}
          type={type}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? 'true' : 'false'}
          className={`block w-full rounded-xl border border-[#D6CFBE] bg-white py-[13px] text-[15px] text-[#1F1E1D] outline-none transition placeholder:text-[#A19F98] focus:border-[#C96442] focus:shadow-[0_0_0_4px_rgba(201,100,66,0.18)] ${icon ? 'pl-11 pr-4' : 'px-4'} ${trailing ? 'pr-16' : ''}`}
        />
        {trailing ? (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        ) : null}
      </div>
      {error ? (
        <span className="mt-0.5 text-[12.5px] text-[#C96442]">{error}</span>
      ) : null}
    </div>
  )
}

export function PasswordField({
  label,
  name,
  autoComplete,
  error,
  trailingLink,
}: {
  label: string
  name: string
  autoComplete?: string
  error?: string
  trailingLink?: ReactNode
}) {
  const [show, setShow] = useState(false)
  const inputId = `auth-${name}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={inputId}
          className="text-[13px] font-medium tracking-[-0.005em] text-[#3A3835]"
        >
          {label}
        </label>
        {trailingLink}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 grid -translate-y-1/2 place-items-center text-[#A19F98]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <input
          id={inputId}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          placeholder="8+ characters"
          aria-invalid={error ? 'true' : 'false'}
          className="block w-full rounded-xl border border-[#D6CFBE] bg-white py-[13px] pl-11 pr-16 text-[15px] text-[#1F1E1D] outline-none transition placeholder:text-[#A19F98] focus:border-[#C96442] focus:shadow-[0_0_0_4px_rgba(201,100,66,0.18)]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.06em] text-[#6B6862] hover:text-[#1F1E1D]"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <span className="mt-0.5 text-[12.5px] text-[#C96442]">{error}</span>
      ) : null}
    </div>
  )
}

export function Checkbox({
  name,
  children,
  defaultChecked,
}: {
  name: string
  children: ReactNode
  defaultChecked?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.45] text-[#3A3835]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-[5px] border-[1.5px] border-[#D6CFBE] bg-white transition peer-checked:border-[#C96442] peer-checked:bg-[#C96442] peer-focus-visible:shadow-[0_0_0_3px_rgba(201,100,66,0.25)] [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span>{children}</span>
    </label>
  )
}

export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#C96442] px-6 py-[14px] text-[15px] font-medium text-[#FFF8F1] shadow-[inset_0_1px_0_rgba(0,0,0,0.05),0_8px_22px_-10px_rgba(201,100,66,0.7)] transition hover:bg-[#B5563A] disabled:cursor-not-allowed disabled:bg-[#D6CFBE] disabled:text-[#A19F98] disabled:shadow-none"
    >
      {pending ? 'One moment…' : children}
      {pending ? null : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      )}
    </button>
  )
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-xl border border-[rgba(201,100,66,0.3)] bg-[rgba(242,221,210,0.5)] px-3.5 py-2.5 text-[13px] text-[#6E2E1B]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px flex-shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{message}</span>
    </div>
  )
}

export function EmailIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

export function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

export function AuthTabs({ active }: { active: 'signin' | 'signup' }) {
  return (
    <div className="mx-auto mb-7 inline-flex self-center rounded-full border border-[#E5DFD0] bg-white p-1 text-[13px]">
      <a
        href="/login"
        className={`rounded-full px-[22px] py-[9px] font-medium transition ${
          active === 'signin'
            ? 'bg-[#F5F1E8] text-[#1F1E1D] shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
            : 'text-[#6B6862] hover:text-[#1F1E1D]'
        }`}
      >
        Sign in
      </a>
      <a
        href="/signup"
        className={`rounded-full px-[22px] py-[9px] font-medium transition ${
          active === 'signup'
            ? 'bg-[#F5F1E8] text-[#1F1E1D] shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
            : 'text-[#6B6862] hover:text-[#1F1E1D]'
        }`}
      >
        Sign up
      </a>
    </div>
  )
}
