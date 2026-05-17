import 'server-only'
import { cookies } from 'next/headers'
import { LANG_COOKIE, readLangFromCookie } from './i18n'
import type { OnboardingLang } from './types'

export async function getOnboardingLang(): Promise<OnboardingLang> {
  const jar = await cookies()
  return readLangFromCookie(jar.get(LANG_COOKIE)?.value)
}
