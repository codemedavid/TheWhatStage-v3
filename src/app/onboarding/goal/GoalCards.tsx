'use client'

import { useActionState, useState } from 'react'
import { saveGoalAction, type GoalFormState } from '../actions'
import { ACTION_PAGE_KINDS, type ActionPageKind } from '@/lib/action-pages/kinds'
import { StepNav } from '../_components/StepNav'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

const LABEL_KEY: Record<ActionPageKind, DictKey> = {
  form: 'goal.kind.form',
  booking: 'goal.kind.booking',
  qualification: 'goal.kind.qualification',
  sales: 'goal.kind.sales',
  catalog: 'goal.kind.catalog',
  realestate: 'goal.kind.realestate',
}
const BLURB_KEY: Record<ActionPageKind, DictKey> = {
  form: 'goal.kind.form.blurb',
  booking: 'goal.kind.booking.blurb',
  qualification: 'goal.kind.qualification.blurb',
  sales: 'goal.kind.sales.blurb',
  catalog: 'goal.kind.catalog.blurb',
  realestate: 'goal.kind.realestate.blurb',
}

const RECOMMENDED_FOR: Record<string, ActionPageKind> = {
  service: 'booking',
  ecom: 'catalog',
  digital: 'sales',
  realestate: 'realestate',
}

export function GoalCards({ lang, businessType }: { lang: OnboardingLang; businessType: string | null }) {
  const recommended = (businessType && RECOMMENDED_FOR[businessType]) || 'booking'
  const [selected, setSelected] = useState<ActionPageKind>(recommended)
  const [state, action, pending] = useActionState<GoalFormState, FormData>(saveGoalAction, {})

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value={selected} />

      <ul className="ob-choice-grid sm:grid sm:grid-cols-2">
        {ACTION_PAGE_KINDS.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              onClick={() => setSelected(kind)}
              className={`ob-choice w-full flex-col items-start ${selected === kind ? 'selected' : ''}`}
            >
              <span className="text-sm font-semibold">{t(LABEL_KEY[kind], lang)}</span>
              <span className="text-xs text-[color:var(--ink-3)]">{t(BLURB_KEY[kind], lang)}</span>
              {kind === recommended && (
                <span
                  className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
                >
                  {t('goal.recommended', lang)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-red-600">{t('goal.error', lang)}</p>}

      <StepNav
        step="goal"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="ob-btn ob-btn-primary"
          >
            {pending ? t('goal.saving', lang) : t('goal.save', lang)}
          </button>
        }
      />
    </form>
  )
}
