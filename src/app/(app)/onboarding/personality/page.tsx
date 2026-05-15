import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function PersonalityPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="personality" lang={lang} titleKey="checklist.personality" />
}
