import Link from 'next/link'
import { Suspense } from 'react'
import { after } from 'next/server'
import { WizardShell } from '../_components/WizardShell'
import { FlowForm } from './FlowForm'
import { FlowPreview } from './FlowPreview'
import { GenerationGate } from '../_components/GenerationGate'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import {
  getBusinessBasics,
  getOnboardingState,
  getPrimaryActionPage,
} from '@/lib/onboarding/state'
import { getJob } from '@/lib/onboarding/generation/repo'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { getAuthUser } from '@/lib/supabase/server'
import { t } from '@/lib/onboarding/i18n'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import { parseBotInstructionsResult } from '@/lib/onboarding/ai/result-schemas'
import type { OnboardingLang } from '@/lib/onboarding/types'
import { stepEyebrow } from '../_components/stepEyebrow'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function FlowPage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step="flow">
      <p className="ob-eyebrow">{stepEyebrow('flow', lang)}</p>
      <h1 className="ob-title">{t('flow.heading', lang)}</h1>
      <p className="ob-sub">{t('flow.subheading', lang)}</p>
      <Suspense fallback={<GateSkeleton />}>
        <FlowBody lang={lang} />
      </Suspense>
    </WizardShell>
  )
}

async function FlowBody({ lang }: { lang: OnboardingLang }) {
  const [page, state, user] = await Promise.all([
    getPrimaryActionPage(),
    getOnboardingState(),
    getAuthUser(),
  ])

  if (!page) {
    return (
      <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p>{t('flow.error.no_goal', lang)}</p>
        <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
          {t('shell.back', lang)}
        </Link>
      </div>
    )
  }

  const job = user ? await getJob(user.id, 'bot_instructions') : null

  const parsedBot = job?.status === 'done' ? parseBotInstructionsResult(job.result) : null
  if (parsedBot) {
    return (
      <div className="mt-6">
        <FlowPreview lang={lang} pageId={page.id} initial={parsedBot} />
      </div>
    )
  }

  const hasDescription = (state?.flow_description ?? '').trim().length >= 20
  const shouldRescue = !job && hasDescription && !!user
  if (shouldRescue) {
    const basics = await getBusinessBasics()
    if (basics) {
      const cfg = (page.config as Record<string, unknown> | null) ?? {}
      const cta = cfg.cta as { primary_label?: string } | undefined
      const ctaLabel = cta?.primary_label ?? page.title
      const profileId = user!.id
      const flowDescription = state!.flow_description!
      after(async () => {
        await runGeneration(profileId, 'bot_instructions', {
          basics,
          goal: page.kind as ActionPageKind,
          actionPage: { title: page.title, ctaLabel, slug: page.slug },
          flowDescription,
          lang,
        })
      })
    }
  }

  if (job?.status === 'running' || job?.status === 'queued' || shouldRescue) {
    return (
      <GenerationGate
        kind="bot_instructions"
        animationHeading={t('gen.bot.heading', lang)}
        animationLines={[t('gen.bot.line1', lang), t('gen.bot.line2', lang)]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/onboarding/done"
        skipLabel={t('gen.skip', lang)}
        lang={lang}
      />
    )
  }

  return (
    <div className="mt-6">
      {job?.status === 'failed' ? (
        <p className="mb-3 text-sm text-red-600">{t('gen.error.generic', lang)}</p>
      ) : null}
      <FlowForm
        lang={lang}
        pageId={page.id}
        pageTitle={page.title}
        initialDescription={state?.flow_description ?? ''}
      />
    </div>
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
