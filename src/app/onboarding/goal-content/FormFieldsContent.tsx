import { generateFormFieldsAction } from '../actions'
import { FormFieldsEditor } from './FormFieldsEditor'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

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
  const existing = ((config as { blocks?: unknown[] })?.blocks ?? []) as { id: string; label?: string; prompt?: string }[]
  let blocks = existing
  if (blocks.length === 0) {
    const r = await generateFormFieldsAction(kind)
    if (r.ok) blocks = r.blocks
    else {
      return (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {t('gc.form.error.generation', lang)}
        </div>
      )
    }
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-700">
        {kind === 'qualification' ? t('gc.qualification.heading', lang) : t('gc.form.heading', lang)}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">{t('gc.form.subheading', lang)}</p>
      <FormFieldsEditor lang={lang} pageId={pageId} initialBlocks={blocks} kind={kind} />
    </div>
  )
}
