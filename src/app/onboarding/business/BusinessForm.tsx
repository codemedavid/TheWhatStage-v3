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

  return (
    <form action={action} className="space-y-5">
      <Field
        name="name"
        label={t('business.name.label', lang)}
        placeholder={t('business.name.ph', lang)}
        defaultValue={initial?.name ?? ''}
        error={err('name')}
        maxLength={120}
      />
      <Field
        name="offer"
        label={t('business.offer.label', lang)}
        placeholder={t('business.offer.ph', lang)}
        defaultValue={initial?.offer ?? ''}
        error={err('offer')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900">
          {t('business.type.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BUSINESS_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="business_type"
                value={type}
                defaultChecked={(initial?.business_type ?? 'service') === type}
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
        defaultValue={initial?.audience ?? ''}
        error={err('audience')}
        maxLength={500}
        textarea
      />
      <Field
        name="pain"
        label={t('business.pain.label', lang)}
        placeholder={t('business.pain.ph', lang)}
        defaultValue={initial?.pain ?? ''}
        error={err('pain')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900">
          {t('business.tone.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TONE_PRESETS.map((tone) => (
            <label
              key={tone}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="tone"
                value={tone}
                defaultChecked={(initial?.tone ?? 'friendly') === tone}
                className="sr-only"
              />
              {t(TONE_LABEL_KEY[tone], lang)}
            </label>
          ))}
        </div>
      </fieldset>

      {state.formError && (
        <p className="text-sm text-red-600">{state.formError}</p>
      )}

      <StepNav
        step="business"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
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
}: {
  name: string
  label: string
  placeholder?: string
  defaultValue?: string
  error?: string
  textarea?: boolean
  maxLength?: number
}) {
  const cls =
    'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600'
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-900">{label}</span>
      {textarea ? (
        <textarea
          name={name}
          rows={3}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cls}
        />
      ) : (
        <input
          type="text"
          name={name}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cls}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  )
}
