'use client'

import { useActionState } from 'react'
import {
  saveBusinessBasicsAction,
  type BusinessBasicsFormState,
} from '../actions'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import { BUSINESS_TYPES, TONE_PRESETS, type BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import { StepNav } from '../_components/StepNav'

interface Props {
  lang: OnboardingLang
  initial: Partial<BusinessBasics> | null
}

const TYPE_LABEL_KEY: Record<(typeof BUSINESS_TYPES)[number], DictKey> = {
  service: 'business.type.service',
  ecom: 'business.type.ecom',
  digital: 'business.type.digital',
  realestate: 'business.type.realestate',
}

const TONE_LABEL_KEY: Record<(typeof TONE_PRESETS)[number], DictKey> = {
  friendly: 'business.tone.friendly',
  professional: 'business.tone.professional',
  playful: 'business.tone.playful',
  calm: 'business.tone.calm',
}

export function BusinessForm({ lang, initial }: Props) {
  const [state, action, pending] = useActionState<BusinessBasicsFormState, FormData>(
    saveBusinessBasicsAction,
    {},
  )
  const err = (k: string) => state.fieldErrors?.[k]
  // Prefer echoed-back values from a failed submit over initial DB values, so
  // the form preserves whatever the user typed instead of wiping it.
  const v = (k: keyof NonNullable<BusinessBasicsFormState['values']>) =>
    state.values?.[k] ?? (initial?.[k as keyof typeof initial] as string | undefined) ?? ''

  return (
    <form action={action} className="space-y-5" key={state.values ? 'retry' : 'fresh'}>
      {state.formError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {state.formError}
        </div>
      )}
      <Field
        name="name"
        label={t('business.name.label', lang)}
        placeholder={t('business.name.ph', lang)}
        defaultValue={v('name')}
        error={err('name')}
        maxLength={120}
        autoComplete="organization"
      />
      <Field
        name="offer"
        label={t('business.offer.label', lang)}
        placeholder={t('business.offer.ph', lang)}
        defaultValue={v('offer')}
        error={err('offer')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="ob-label">
          {t('business.type.label', lang)}
        </legend>
        <div role="radiogroup" aria-label={t('business.type.label', lang)} className="ob-choice-grid mt-2 sm:grid sm:grid-cols-4">
          {BUSINESS_TYPES.map((type) => (
            <label key={type} className="ob-choice justify-center">
              <input
                type="radio"
                name="business_type"
                value={type}
                defaultChecked={(state.values?.business_type ?? initial?.business_type ?? 'service') === type}
                className="sr-only"
              />
              {t(TYPE_LABEL_KEY[type], lang)}
            </label>
          ))}
        </div>
        {err('business_type') && (
          <p className="mt-1 text-xs text-red-600">{err('business_type')}</p>
        )}
      </fieldset>

      <Field
        name="audience"
        label={t('business.audience.label', lang)}
        placeholder={t('business.audience.ph', lang)}
        defaultValue={v('audience')}
        error={err('audience')}
        maxLength={500}
        textarea
      />
      <Field
        name="pain"
        label={t('business.pain.label', lang)}
        placeholder={t('business.pain.ph', lang)}
        defaultValue={v('pain')}
        error={err('pain')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="ob-label">
          {t('business.tone.label', lang)}
        </legend>
        <div role="radiogroup" aria-label={t('business.tone.label', lang)} className="ob-choice-grid mt-2 sm:grid sm:grid-cols-4">
          {TONE_PRESETS.map((tone) => (
            <label key={tone} className="ob-choice justify-center">
              <input
                type="radio"
                name="tone"
                value={tone}
                defaultChecked={(state.values?.tone ?? initial?.tone ?? 'friendly') === tone}
                className="sr-only"
              />
              {t(TONE_LABEL_KEY[tone], lang)}
            </label>
          ))}
        </div>
      </fieldset>

      <StepNav
        step="business"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="ob-btn ob-btn-primary"
          >
            {pending ? t('business.saving', lang) : t('business.save', lang)}
          </button>
        }
      />
    </form>
  )
}

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  error,
  textarea = false,
  maxLength,
  autoComplete = 'off',
}: {
  name: string
  label: string
  placeholder?: string
  defaultValue?: string
  error?: string
  textarea?: boolean
  maxLength?: number
  autoComplete?: string
}) {
  return (
    <label className="ob-field">
      <span className="ob-label">{label}</span>
      {textarea ? (
        <textarea
          name={name}
          rows={3}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="ob-textarea"
        />
      ) : (
        <input
          type="text"
          name={name}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="ob-input"
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  )
}
