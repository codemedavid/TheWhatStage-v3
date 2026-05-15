import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function GoalPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="goal" lang={lang} titleKey="checklist.goal" />
}
