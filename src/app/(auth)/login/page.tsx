import { safeNextPath } from '@/lib/oauth/safe-next'
import { LoginForm } from './login-form'

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next
  return <LoginForm next={safeNextPath(rawNext)} />
}
