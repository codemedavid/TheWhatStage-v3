import { WizardShell } from '../_components/WizardShell'
import { PersonalityForm } from './PersonalityForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getOnboardingState } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { VibePreset } from '@/lib/onboarding/ai/personality'
import { stepEyebrow } from '../_components/stepEyebrow'

export const dynamic = 'force-dynamic'

interface Seeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

function readSeeds(value: unknown): Seeds | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  return {
    vibe_preset: typeof r.vibe_preset === 'string' ? (r.vibe_preset as VibePreset) : undefined,
    greet: typeof r.greet === 'string' ? r.greet : undefined,
    must_use: typeof r.must_use === 'string' ? r.must_use : undefined,
    must_not: typeof r.must_not === 'string' ? r.must_not : undefined,
  }
}

export default async function PersonalityPage() {
  const [lang, state] = await Promise.all([getOnboardingLang(), getOnboardingState()])
  const initial = readSeeds(state?.personality_seeds)

  return (
    <WizardShell lang={lang} step="personality">
      <p className="ob-eyebrow">{stepEyebrow('personality', lang)}</p>
      <h1 className="ob-title">{t('personality.heading', lang)}</h1>
      <p className="ob-sub">{t('personality.subheading', lang)}</p>
      <PersonalityForm lang={lang} initial={initial} />
    </WizardShell>
  )
}
