import { after } from 'next/server'
import { generateFormFieldsAction } from '../actions'
import { FormFieldsEditor } from './FormFieldsEditor'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { createClient } from '@/lib/supabase/server'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface SuggestedBlockShape {
  id: string
  label?: string
  prompt?: string
}

function isBlocks(v: unknown): v is { blocks: SuggestedBlockShape[] } {
  return !!v && typeof v === 'object' && Array.isArray((v as { blocks?: unknown }).blocks)
}

export async function FormFieldsContent({
  lang,
  pageId,
  kind,
  config,
}: {
  lang: OnboardingLang
  pageId: string
  kind: 'form' | 'qualification'
  config: unknown
}) {
  const existing = ((config as { blocks?: unknown[] })?.blocks ?? []) as SuggestedBlockShape[]
  if (existing.length > 0) {
    return (
      <div>
        <h2 className="text-sm font-medium text-zinc-700">
          {kind === 'qualification' ? t('gc.qualification.heading', lang) : t('gc.form.heading', lang)}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">{t('gc.form.subheading', lang)}</p>
        <FormFieldsEditor lang={lang} pageId={pageId} initialBlocks={existing} kind={kind} />
      </div>
    )
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'form_fields') : null

  if (job?.status === 'done' && isBlocks(job.result)) {
    return (
      <div>
        <h2 className="text-sm font-medium text-zinc-700">
          {kind === 'qualification' ? t('gc.qualification.heading', lang) : t('gc.form.heading', lang)}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">{t('gc.form.subheading', lang)}</p>
        <FormFieldsEditor lang={lang} pageId={pageId} initialBlocks={job.result.blocks} kind={kind} />
      </div>
    )
  }

  if (job?.status === 'failed') {
    const r = await generateFormFieldsAction(kind)
    if (r.ok) {
      return (
        <div>
          <h2 className="text-sm font-medium text-zinc-700">
            {kind === 'qualification' ? t('gc.qualification.heading', lang) : t('gc.form.heading', lang)}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">{t('gc.form.subheading', lang)}</p>
          <FormFieldsEditor lang={lang} pageId={pageId} initialBlocks={r.blocks} kind={kind} />
        </div>
      )
    }
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        {t('gc.form.error.generation', lang)}
      </div>
    )
  }

  // Lazily enqueue if no job row exists yet.
  if (!job && auth.user) {
    const basics = await getBusinessBasics()
    if (basics) {
      const profileId = auth.user.id
      const { data: stateRow } = await supabase
        .from('onboarding_state')
        .select('ui_language')
        .eq('profile_id', profileId)
        .maybeSingle()
      const pageLang = stateRow?.ui_language === 'en' ? 'en' : 'tl'
      after(async () => {
        await runGeneration(profileId, 'form_fields', { basics, kind, lang: pageLang })
      })
    }
  }

  return (
    <GenerationGate
      kind="form_fields"
      animationHeading={t('gen.form_fields.heading', lang)}
      animationLines={[
        t('gen.form_fields.line1', lang),
        t('gen.form_fields.line2', lang),
      ]}
      errorMessage={t('gen.error.generic', lang)}
      skipHref="/onboarding/flow"
      skipLabel={t('gen.skip', lang)}
    />
  )
}
