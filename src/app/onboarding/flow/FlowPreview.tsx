'use client'

import { useActionState, useState } from 'react'
import { saveFlowAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'

export function FlowPreview({
  lang, pageId, initial, onBack,
}: {
  lang: OnboardingLang; pageId: string; initial: GeneratedBotInstructions; onBack: () => void
}) {
  const [data, setData] = useState(initial)
  const [state, action, pending] = useActionState(saveFlowAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="required_slots_json" value={JSON.stringify(data.required_slots)} />
      <input type="hidden" name="confidence_threshold" value={String(data.confidence_threshold)} />

      <Section title={t('flow.preview.bot_instructions', lang)}>
        <textarea
          name="bot_send_instructions"
          rows={4}
          maxLength={2000}
          value={data.bot_send_instructions}
          onChange={(e) => setData((p) => ({ ...p, bot_send_instructions: e.target.value }))}
          className={inp}
        />
      </Section>

      <Section title={t('flow.preview.rules', lang)}>
        <textarea
          name="recommendation_rules"
          rows={4}
          maxLength={2000}
          value={data.recommendation_rules}
          onChange={(e) => setData((p) => ({ ...p, recommendation_rules: e.target.value }))}
          className={inp}
        />
      </Section>

      <div className="text-xs text-zinc-600">
        <span className="font-medium">{t('flow.preview.slots', lang)}: </span>
        {data.required_slots.length === 0 ? '—' : data.required_slots.join(', ')}
      </div>

      <button type="button" onClick={onBack} className="text-sm text-zinc-600 hover:text-zinc-900">{t('shell.back', lang)}</button>

      {state.error && <p className="text-sm text-red-600">{t('flow.error.save', lang)}</p>}

      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('flow.saving', lang) : t('flow.save', lang)}
        </button>
      } />
    </form>
  )
}

const inp = 'mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600'
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-900">{title}</h3>
      {children}
    </div>
  )
}
