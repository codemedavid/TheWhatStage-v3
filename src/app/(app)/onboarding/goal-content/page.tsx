import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function GoalContentPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="goal_content" lang={lang} titleKey="checklist.goal_content" />
}
