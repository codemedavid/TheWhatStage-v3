'use client'

import { useActionState, useState } from 'react'
import { saveFlowAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'

export function FlowPreview({
  lang, pageId, initial,
}: {
  lang: OnboardingLang; pageId: string; initial: GeneratedBotInstructions
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
          className="ob-textarea"
        />
      </Section>

      <Section title={t('flow.preview.rules', lang)}>
        <textarea
          name="recommendation_rules"
          rows={4}
          maxLength={2000}
          value={data.recommendation_rules}
          onChange={(e) => setData((p) => ({ ...p, recommendation_rules: e.target.value }))}
          className="ob-textarea"
        />
      </Section>

      <div className="ob-help">
        <span className="font-medium">{t('flow.preview.slots', lang)}: </span>
        {data.required_slots.length === 0 ? '—' : data.required_slots.join(', ')}
      </div>

      {state.error && <p className="text-sm text-red-600">{t('flow.error.save', lang)}</p>}

      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="ob-btn ob-btn-primary">
          {pending ? t('flow.saving', lang) : t('flow.save', lang)}
        </button>
      } />
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ob-field">
      <h3 className="ob-label">{title}</h3>
      {children}
    </div>
  )
}
