import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { getPostAuthRedirect } from '@/lib/onboarding/post-auth-redirect'

export default async function Home() {
  const session = await getSession()
  if (!session) redirect('/login')
  redirect(await getPostAuthRedirect())
}
