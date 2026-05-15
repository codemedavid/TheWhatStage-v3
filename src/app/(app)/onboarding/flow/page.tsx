import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function FlowPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="flow" lang={lang} titleKey="checklist.flow" />
}
