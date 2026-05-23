'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signInAction, type AuthFormState } from '../actions'
import {
  AuthTabs,
  EmailIcon,
  Field,
  FormError,
  PasswordField,
  SubmitButton,
} from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, initialState)

  return (
    <div className="flex flex-col">
      <AuthTabs active="signin" />

      <h1 className="mb-2.5 font-[family-name:var(--font-instrument-serif)] text-[clamp(34px,3.6vw,44px)] font-normal leading-[1.1] tracking-[-0.02em]">
        Welcome <em className="italic text-[#C96442]">back.</em>
      </h1>
      <p className="mb-7 text-[15px] leading-[1.5] text-[#6B6862]">
        Sign in to access your bot and your chats.
      </p>

      <FormError message={state.formError} />

      <form action={formAction} className="flex flex-col gap-4">
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
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          trailingLink={
            <Link
              href="/auth/forgot"
              className="text-[12.5px] font-medium text-[#C96442] hover:underline"
            >
              Forgot?
            </Link>
          }
        />
        <SubmitButton>Sign in</SubmitButton>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-[#6B6862]">
        New here?{' '}
        <Link
          href="/signup"
          className="font-medium text-[#C96442] hover:underline"
        >
          Create an account →
        </Link>
      </p>
    </div>
  )
}
