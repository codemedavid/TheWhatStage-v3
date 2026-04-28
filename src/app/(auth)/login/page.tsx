'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signInAction, type AuthFormState } from '../actions'
import { Field, FormError, SubmitButton } from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, initialState)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Sign in</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <FormError message={state.formError} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
        />
        <SubmitButton>Sign in</SubmitButton>
      </form>

      <p className="text-[13px] text-[#6B7280]">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-[#059669] hover:underline">
          Create one
        </Link>
      </p>
    </div>
  )
}
