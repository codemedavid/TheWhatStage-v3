'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signUpAction, type AuthFormState } from '../actions'
import {
  AuthTabs,
  Checkbox,
  EmailIcon,
  Field,
  FormError,
  PasswordField,
  SubmitButton,
  UserIcon,
} from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function SignupPage() {
  const [state, formAction] = useActionState(signUpAction, initialState)

  return (
    <div className="flex flex-col">
      <AuthTabs active="signup" />

      <h1 className="mb-2.5 font-[family-name:var(--font-instrument-serif)] text-[clamp(34px,3.6vw,44px)] font-normal leading-[1.1] tracking-[-0.02em]">
        Let&rsquo;s get <em className="italic text-[#C96442]">started.</em>
      </h1>
      <p className="mb-7 text-[15px] leading-[1.5] text-[#6B6862]">
        Create your WhatStage account. Takes about 30 seconds.
      </p>

      <FormError message={state.formError} />

      <form action={formAction} className="flex flex-col gap-4">
        <Field
          label="Full name"
          name="full_name"
          autoComplete="name"
          placeholder="e.g. David Reyes"
          icon={<UserIcon />}
          error={state.fieldErrors?.full_name}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@email.com"
          icon={<EmailIcon />}
          error={state.fieldErrors?.email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          error={state.fieldErrors?.password}
        />
        <Checkbox name="agree">
          I agree to WhatStage&rsquo;s{' '}
          <Link href="/terms" className="text-[#C96442] hover:underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-[#C96442] hover:underline">
            Privacy Policy
          </Link>
          .
        </Checkbox>
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-[#6B6862]">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-[#C96442] hover:underline"
        >
          Sign in →
        </Link>
      </p>
    </div>
  )
}
