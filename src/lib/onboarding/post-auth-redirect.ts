import 'server-only'
import { getOnboardingState } from './state'
import { STEP_ORDER } from './steps'

/**
 * Where to send a signed-in user. If they have an active onboarding row
 * (not completed, not dismissed), go to the welcome page; otherwise the
 * dashboard. Missing row defaults to /onboarding/welcome so freshly created
 * accounts still see it before LaunchChecklist races ahead.
 */
export async function getPostAuthRedirect(): Promise<string> {
  const state = await getOnboardingState()
  if (!state) return '/onboarding/welcome'
  if (state.completed_at || state.dismissed_at) return '/dashboard'
  // Send users straight to their next incomplete step, or welcome on first visit.
  const allUntouched = STEP_ORDER.every((s) => !s.isComplete(state))
  if (allUntouched) return '/onboarding/welcome'
  const next = STEP_ORDER.find((s) => !s.isComplete(state))
  return next?.route ?? '/onboarding/done'
}
