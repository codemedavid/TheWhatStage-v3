import { setLangAction } from '../actions'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function LangToggle({ lang }: { lang: OnboardingLang }) {
  const next: OnboardingLang = lang === 'tl' ? 'en' : 'tl'
  return (
    <form action={setLangAction}>
      <input type="hidden" name="lang" value={next} />
      <button
        type="submit"
        className="text-xs font-medium px-2 py-1 rounded border border-zinc-300 hover:bg-zinc-50"
        aria-label={`Switch language to ${next.toUpperCase()}`}
      >
        {lang === 'tl' ? 'EN' : 'TL'}
      </button>
    </form>
  )
}
