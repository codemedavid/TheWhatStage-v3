import Link from 'next/link'
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

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function FlowPage() {
  const [lang, page, state, user] = await Promise.all([
    getOnboardingLang(),
    getPrimaryActionPage(),
    getOnboardingState(),
    getAuthUser(),
  ])

  if (!page) {
    return (
      <WizardShell lang={lang} step="flow">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('flow.error.no_goal', lang)}</p>
          <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  const job = user ? await getJob(user.id, 'bot_instructions') : null

  const heading = (
    <>
      <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('flow.subheading', lang)}</p>
    </>
  )

  const parsedBot = job?.status === 'done' ? parseBotInstructionsResult(job.result) : null
  if (parsedBot) {
    return (
      <WizardShell lang={lang} step="flow">
        {heading}
        <div className="mt-6">
          <FlowPreview lang={lang} pageId={page.id} initial={parsedBot} />
        </div>
      </WizardShell>
    )
  }

  // Lazy-enqueue rescue: if the user already submitted a flow_description but
  // there's no job row (e.g. after() never executed because the request died
  // mid-flight), schedule it now and surface the gate so the user sees progress
  // instead of being silently dropped back on the empty form.
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
          actionPage: { title: page.title, ctaLabel },
          flowDescription,
          lang,
        })
      })
    }
  }

  if (job?.status === 'running' || job?.status === 'queued' || shouldRescue) {
    return (
      <WizardShell lang={lang} step="flow">
        {heading}
        <GenerationGate
          kind="bot_instructions"
          animationHeading={t('gen.bot.heading', lang)}
          animationLines={[t('gen.bot.line1', lang), t('gen.bot.line2', lang)]}
          errorMessage={t('gen.error.generic', lang)}
          skipHref="/onboarding/done"
          skipLabel={t('gen.skip', lang)}
        />
      </WizardShell>
    )
  }

  // No job yet, or failed → render the form to (re-)start generation.
  return (
    <WizardShell lang={lang} step="flow">
      {heading}
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
    </WizardShell>
  )
}
