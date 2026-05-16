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
        <legend className="block text-sm font-medium text-zinc-900">
          {t('personality.vibe.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VIBE_PRESETS.map((vibe) => (
            <label
              key={vibe}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="vibe_preset"
                value={vibe}
                defaultChecked={(initial?.vibe_preset ?? 'friendly_kuya_ate') === vibe}
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
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
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
    <label className="block">
      <span className="block text-sm font-medium text-zinc-900">{label}</span>
      <input
        type="text"
        name={name}
        maxLength={300}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
    </label>
  )
}
