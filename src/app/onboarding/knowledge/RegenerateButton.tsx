'use client'

import { useFormStatus } from 'react-dom'
import { retryGenerationAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GenerationKind } from '@/lib/onboarding/generation/types'

/**
 * Re-runs the AI generation for `kind` by submitting `retryGenerationAction`,
 * which clears the existing job row and re-enqueues a fresh run. The action
 * `redirect()`s back to the same page; the gate re-mounts and starts polling
 * the new job. Previously this only called `router.refresh()`, which left the
 * cached 'done' row in place — the label said "Regenerate" but the AI never
 * re-ran.
 */
export function RegenerateButton({
  lang,
  kind,
}: {
  lang: OnboardingLang
  kind: GenerationKind
}) {
  return (
    <form action={retryGenerationAction}>
      <input type="hidden" name="kind" value={kind} />
      <RegenerateSubmit lang={lang} />
    </form>
  )
}

function RegenerateSubmit({ lang }: { lang: OnboardingLang }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="ob-btn ob-btn-text"
    >
      {pending ? t('knowledge.generating', lang) : t('knowledge.regenerate', lang)}
    </button>
  )
}
