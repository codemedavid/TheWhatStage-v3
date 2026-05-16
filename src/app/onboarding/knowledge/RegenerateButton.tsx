'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function RegenerateButton({ lang }: { lang: OnboardingLang }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="text-sm font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-60"
    >
      {pending ? t('knowledge.generating', lang) : t('knowledge.regenerate', lang)}
    </button>
  )
}
