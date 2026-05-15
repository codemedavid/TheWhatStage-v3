import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function FaqsPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="faqs" lang={lang} titleKey="checklist.faqs" />
}
