import Link from 'next/link'
import { Suspense } from 'react'
import { after } from 'next/server'
import { WizardShell } from '../_components/WizardShell'
import { FaqChecklist } from './FaqChecklist'
import { RegenerateButton } from '../knowledge/RegenerateButton'
import { retryGenerationAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { getAuthUser } from '@/lib/supabase/server'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { parseFaqsResult } from '@/lib/onboarding/ai/result-schemas'
import type { OnboardingLang } from '@/lib/onboarding/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function FaqsPage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step="faqs">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>
      <Suspense fallback={<GateSkeleton />}>
        <FaqsBody lang={lang} />
      </Suspense>
    </WizardShell>
  )
}

async function FaqsBody({ lang }: { lang: OnboardingLang }) {
  const user = await getAuthUser()
  const [basics, job] = await Promise.all([
    getBusinessBasics(),
    user ? getJob(user.id, 'faqs') : Promise.resolve(null),
  ])

  if (!basics) {
    return (
      <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p>{t('faqs.error.no_basics', lang)}</p>
        <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
          {t('shell.back', lang)}
        </Link>
      </div>
    )
  }

  const parsedFaqs = job?.status === 'done' ? parseFaqsResult(job.result) : null
  if (parsedFaqs) {
    return (
      <div className="mt-6">
        <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} kind="faqs" /></div>
        <FaqChecklist lang={lang} suggestions={parsedFaqs.suggestions} />
      </div>
    )
  }

  if (job?.status === 'failed') {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{t('faqs.error.generation', lang)}</p>
        <p className="mt-2 text-xs text-red-800/80">{job.error ?? 'unknown_error'}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form action={retryGenerationAction}>
            <input type="hidden" name="kind" value="faqs" />
            <button type="submit" className="font-medium underline">
              {t('faqs.regenerate', lang)}
            </button>
          </form>
          <Link href="/onboarding/personality" className="font-medium underline">
            {t('gen.skip', lang)}
          </Link>
        </div>
      </div>
    )
  }

  if (!job && user) {
    const profileId = user.id
    after(async () => {
      await runGeneration(profileId, 'faqs', { basics, lang })
    })
  }

  return (
    <GenerationGate
      kind="faqs"
      animationHeading={t('gen.faqs.heading', lang)}
      animationLines={[
        t('gen.faqs.line1', lang),
        t('gen.faqs.line2', lang),
        t('gen.faqs.line3', lang),
      ]}
      errorMessage={t('gen.error.generic', lang)}
      skipHref="/onboarding/personality"
      skipLabel={t('gen.skip', lang)}
    />
  )
}

function GateSkeleton() {
  return (
    <div className="mt-6 animate-pulse rounded-md border border-zinc-200 bg-zinc-50 p-6">
      <div className="h-4 w-2/3 rounded bg-zinc-200" />
      <div className="mt-3 h-3 w-1/2 rounded bg-zinc-200" />
      <div className="mt-6 h-32 rounded bg-zinc-100" />
    </div>
  )
}
