import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  return <StepStub step="knowledge" lang={lang} titleKey="checklist.knowledge" />
}
