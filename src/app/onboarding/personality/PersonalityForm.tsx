'use client'

import { useActionState } from 'react'
import { savePersonalityAction, type PersonalityFormState } from '../actions'
import { VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality-shared'
import { StepNav } from '../_components/StepNav'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface Seeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

interface Props {
  lang: OnboardingLang
  initial: Seeds | null
}

const VIBE_KEY: Record<VibePreset, DictKey> = {
  friendly_kuya_ate: 'personality.vibe.friendly_kuya_ate',
  professional_consultant: 'personality.vibe.professional_consultant',
  hype_closer: 'personality.vibe.hype_closer',
  calm_expert: 'personality.vibe.calm_expert',
}

export function PersonalityForm({ lang, initial }: Props) {
  const [state, action, pending] = useActionState<PersonalityFormState, FormData>(
    savePersonalityAction,
    {},
  )

  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="ob-label">
          {t('personality.vibe.label', lang)}
        </legend>
        <div role="radiogroup" className="ob-choice-grid mt-2 sm:grid sm:grid-cols-4">
          {VIBE_PRESETS.map((vibe) => (
            <label key={vibe} className="ob-choice justify-center">
              <input
                type="radio"
                name="vibe_preset"
                value={vibe}
                defaultChecked={(initial?.vibe_preset ?? 'hype_closer') === vibe}
                className="sr-only"
              />
              {t(VIBE_KEY[vibe], lang)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field name="greet"     label={t('personality.greet.label', lang)}     placeholder={t('personality.greet.ph', lang)}     defaultValue={initial?.greet ?? ''} />
      <Field name="must_use"  label={t('personality.must_use.label', lang)}  placeholder={t('personality.must_use.ph', lang)}  defaultValue={initial?.must_use ?? ''} />
      <Field name="must_not"  label={t('personality.must_not.label', lang)}  placeholder={t('personality.must_not.ph', lang)}  defaultValue={initial?.must_not ?? ''} />

      {state.error === 'no_basics' && (
        <p className="text-sm text-red-600">{t('personality.error.no_basics', lang)}</p>
      )}
      {state.error && state.error !== 'no_basics' && (
        <p className="text-sm text-red-600">{t('personality.error', lang)}</p>
      )}

      <StepNav
        step="personality"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="ob-btn ob-btn-primary"
          >
            {pending ? t('personality.saving', lang) : t('personality.save', lang)}
          </button>
        }
      />
    </form>
  )
}

function Field({ name, label, placeholder, defaultValue }: { name: string; label: string; placeholder: string; defaultValue: string }) {
  return (
    <label className="ob-field">
      <span className="ob-label">{label}</span>
      <input
        type="text"
        name={name}
        maxLength={300}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="ob-input"
      />
    </label>
  )
}
