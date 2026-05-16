'use client'

import { useRef, useState, useTransition } from 'react'
import { startFlowGenerationAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function FlowForm({
  lang, pageTitle, initialDescription,
}: {
  lang: OnboardingLang; pageId: string; pageTitle: string; initialDescription: string
}) {
  // Uncontrolled input so autofill, password managers, and any non-React-state
  // input mechanism still populates FormData and the length gate below.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [length, setLength] = useState(initialDescription.trim().length)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  async function handleSubmit(formData: FormData) {
    start(async () => {
      setError(null)
      try {
        const r = await startFlowGenerationAction(formData)
        // A successful action redirects (throws NEXT_REDIRECT); only error
        // responses reach here.
        if (r?.error) setError(t('flow.error.save', lang))
      } catch (err) {
        // NEXT_REDIRECT is expected — re-throw so Next can navigate.
        throw err
      }
    })
  }

  const canSubmit = length >= 20 && !pending

  return (
    <form action={handleSubmit} className="space-y-4">
      <p className="text-xs text-zinc-500">{pageTitle}</p>
      <label className="block">
        <span className="block text-sm font-medium text-zinc-900">{t('flow.description.label', lang)}</span>
        <textarea
          ref={textareaRef}
          name="flow_description"
          rows={6}
          required
          minLength={20}
          maxLength={2000}
          defaultValue={initialDescription}
          onInput={(e) => setLength((e.target as HTMLTextAreaElement).value.trim().length)}
          placeholder={t('flow.description.ph', lang)}
          className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={!canSubmit} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('flow.generating', lang) : t('flow.generate', lang)}
        </button>
      } />
    </form>
  )
}
