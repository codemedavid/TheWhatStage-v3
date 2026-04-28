'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signUpAction, type AuthFormState } from '../actions'
import { Field, FormError, SubmitButton } from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function SignupPage() {
  const [state, formAction] = useActionState(signUpAction, initialState)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Create your account</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          It only takes a minute.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <FormError message={state.formError} />
        <Field
          label="Full name"
          name="full_name"
          autoComplete="name"
          error={state.fieldErrors?.full_name}
        />
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
          autoComplete="new-password"
          error={state.fieldErrors?.password}
        />
        <p className="text-[12px] text-[#6B7280]">
          At least 8 characters, with a letter and a number.
        </p>
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="text-[13px] text-[#6B7280]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[#059669] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
