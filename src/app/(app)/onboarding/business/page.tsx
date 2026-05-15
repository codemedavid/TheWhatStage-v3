import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function BusinessPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="business" lang={lang} titleKey="checklist.business" />
}
