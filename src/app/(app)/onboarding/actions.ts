'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  completeOnboarding as completeOnboardingState,
  dismissOnboarding as dismissOnboardingState,
  markStep,
  setOnboardingLanguage,
  saveBusinessBasicsToState,
} from '@/lib/onboarding/state'
import { BusinessBasicsSchema } from '@/lib/onboarding/business-basics'
import { LANG_COOKIE } from '@/lib/onboarding/i18n'
import { ONBOARDING_STEPS, type OnboardingLang, type OnboardingStep } from '@/lib/onboarding/types'
import { nextStepRoute } from '@/lib/onboarding/steps'

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export async function setLangAction(formData: FormData): Promise<void> {
  const raw = formData.get('lang')
  const lang: OnboardingLang = raw === 'en' ? 'en' : 'tl'
  const jar = await cookies()
  jar.set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  await setOnboardingLanguage(lang, 'both')
  revalidatePath('/onboarding')
  revalidatePath('/dashboard')
}

export async function skipStepAction(formData: FormData): Promise<void> {
  const step = formData.get('step')
  if (!isStep(step)) throw new Error('invalid step')
  await markStep(step, { skipped: true })
  redirect(nextStepRoute(step))
}

export async function dismissOnboardingAction(): Promise<void> {
  await dismissOnboardingState()
  redirect('/dashboard')
}

export async function completeOnboardingAction(): Promise<void> {
  await completeOnboardingState()
  redirect('/dashboard')
}

export type BusinessBasicsFormState = {
  fieldErrors?: Record<string, string>
  formError?: string
}

export async function saveBusinessBasicsAction(
  _prev: BusinessBasicsFormState,
  formData: FormData,
): Promise<BusinessBasicsFormState> {
  const parsed = BusinessBasicsSchema.safeParse({
    name: formData.get('name'),
    offer: formData.get('offer'),
    business_type: formData.get('business_type'),
    audience: formData.get('audience'),
    pain: formData.get('pain'),
    tone: formData.get('tone'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? '_'
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  try {
    await saveBusinessBasicsToState(parsed.data)
    await markStep('business')
  } catch (err) {
    console.error('[saveBusinessBasicsAction] save error', err)
    return { formError: 'Could not save. Please try again.' }
  }
  redirect('/onboarding/knowledge')
}
