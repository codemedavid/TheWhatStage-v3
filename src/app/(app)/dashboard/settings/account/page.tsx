import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import {
  ChangeEmailForm,
  ChangePasswordForm,
  SignOutEverywhere,
} from './_components/account-forms'

export default async function AccountSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <section className="space-y-4">
      <ChangePasswordForm />
      <ChangeEmailForm currentEmail={session.email} />
      <SignOutEverywhere />
    </section>
  )
}
