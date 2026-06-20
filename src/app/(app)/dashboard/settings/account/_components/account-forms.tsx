'use client'

import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'
import {
  changeEmailAction,
  changePasswordAction,
  signOutEverywhereAction,
} from '../actions'
import {
  ACCOUNT_FORM_IDLE,
  type AccountFormState,
} from '../_lib/account-form-state'

export function ChangePasswordForm() {
  const [state, action] = useActionState<AccountFormState, FormData>(
    changePasswordAction,
    ACCOUNT_FORM_IDLE,
  )

  const currentId = useId()
  const newId = useId()
  const confirmId = useId()
  const errorField = state.status === 'error' ? state.field : undefined

  return (
    <Card
      title="Password"
      description="Change the password you use to sign in. Minimum 10 characters with a letter and a number."
    >
      <form action={action} className="space-y-4" key={state.status === 'ok' ? 'reset' : 'form'}>
        <Field id={currentId} label="Current password">
          <input
            id={currentId}
            type="password"
            name="current_password"
            autoComplete="current-password"
            className={inputClass(errorField === 'current_password')}
          />
        </Field>
        <Field
          id={newId}
          label="New password"
          hint="At least 10 characters, including a letter and a number."
        >
          <input
            id={newId}
            type="password"
            name="new_password"
            autoComplete="new-password"
            className={inputClass(errorField === 'new_password')}
          />
        </Field>
        <Field id={confirmId} label="Confirm new password">
          <input
            id={confirmId}
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            className={inputClass(errorField === 'confirm_password')}
          />
        </Field>

        <Feedback state={state} />

        <SubmitButton idleLabel="Update password" pendingLabel="Updating…" />
      </form>
    </Card>
  )
}

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, action] = useActionState<AccountFormState, FormData>(
    changeEmailAction,
    ACCOUNT_FORM_IDLE,
  )

  const emailId = useId()
  const errorField = state.status === 'error' ? state.field : undefined

  return (
    <Card
      title="Email"
      description="The address you sign in with. Updating it takes effect on your next sign-in."
    >
      <form action={action} className="space-y-4">
        <Field id={emailId} label="Email address">
          <input
            id={emailId}
            type="email"
            name="email"
            defaultValue={currentEmail}
            autoComplete="email"
            className={inputClass(errorField === 'email')}
          />
        </Field>

        <Feedback state={state} />

        <SubmitButton idleLabel="Update email" pendingLabel="Updating…" />
      </form>
    </Card>
  )
}

export function SignOutEverywhere() {
  return (
    <Card
      title="Active sessions"
      description="Sign out of every device, including this one. You'll need to sign in again."
    >
      <form action={signOutEverywhereAction}>
        <DangerButton idleLabel="Sign out everywhere" pendingLabel="Signing out…" />
      </form>
    </Card>
  )
}

function Card({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <h2 className="text-[15px] font-semibold text-[#111827]">{title}</h2>
      <p className="mt-1 text-[13px] text-[#6B7280]">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12px] font-medium text-[#374151]">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[#9CA3AF]">{hint}</p>}
    </div>
  )
}

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-md border bg-white px-3 py-2 text-[13px] text-[#111827] placeholder:text-[#9CA3AF]',
    'focus:outline-none focus:ring-2 focus:ring-offset-0',
    hasError
      ? 'border-[#FCA5A5] focus:border-[#EF4444] focus:ring-[#FECACA]'
      : 'border-[#E5E7EB] focus:border-[#10B981] focus:ring-[#D1FAE5]',
  ].join(' ')
}

function Feedback({ state }: { state: AccountFormState }) {
  if (state.status === 'idle') return null
  const tone = state.status === 'ok' ? 'success' : 'error'
  const styles =
    tone === 'success'
      ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
      : 'border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]'
  return (
    <div className={`rounded-md border px-3 py-2 text-[12px] ${styles}`} role="status">
      {state.message}
    </div>
  )
}

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-[#059669] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#047857] disabled:opacity-60"
    >
      {pending && <Spinner />}
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}

function DangerButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#FCA5A5] bg-white px-4 py-2 text-[13px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-60"
    >
      {pending && <Spinner />}
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
