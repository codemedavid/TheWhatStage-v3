'use client'

import { useState, useTransition } from 'react'
import { generateFlowAction } from '../actions'
import { FlowPreview } from './FlowPreview'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'

export function FlowForm({
  lang, pageId, pageTitle, initialDescription,
}: {
  lang: OnboardingLang; pageId: string; pageTitle: string; initialDescription: string
}) {
  const [description, setDescription] = useState(initialDescription)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedBotInstructions | null>(null)
  const [pending, start] = useTransition()

  async function handleGenerate(formData: FormData) {
    start(async () => {
      setError(null)
      const r = await generateFlowAction(formData)
      if (r.ok) setPreview(r.data)
      else setError(r.error === 'generation_failed' ? t('flow.error.generation', lang) : t('flow.error.save', lang))
    })
  }

  if (preview) {
    return <FlowPreview lang={lang} pageId={pageId} initial={preview} onBack={() => setPreview(null)} />
  }

  return (
    <form action={handleGenerate} className="space-y-4">
      <p className="text-xs text-zinc-500">{pageTitle}</p>
      <label className="block">
        <span className="block text-sm font-medium text-zinc-900">{t('flow.description.label', lang)}</span>
        <textarea
          name="flow_description"
          rows={6}
          required
          minLength={20}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('flow.description.ph', lang)}
          className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={pending || description.trim().length < 20} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('flow.generating', lang) : t('flow.generate', lang)}
        </button>
      } />
    </form>
  )
}
