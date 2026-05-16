import { setLangAction } from '../actions'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function LangToggle({ lang }: { lang: OnboardingLang }) {
  const next: OnboardingLang = lang === 'tl' ? 'en' : 'tl'
  const tlIsActive = lang === 'tl'
  return (
    <form action={setLangAction} className="ob-lang">
      <input type="hidden" name="lang" value={next} />
      {tlIsActive ? (
        <>
          <span className="ob-lang-opt active" aria-hidden>TL</span>
          <button type="submit" className="ob-lang-opt" aria-label="Switch language to EN">EN</button>
        </>
      ) : (
        <>
          <button type="submit" className="ob-lang-opt" aria-label="Switch language to TL">TL</button>
          <span className="ob-lang-opt active" aria-hidden>EN</span>
        </>
      )}
      <style>{`
        .ob-lang {
          display: inline-flex; align-items: center; padding: 3px;
          background: var(--bg-elev, #FBF8F1);
          border: 1px solid var(--line, #E5DFD0);
          border-radius: 999px;
          font-family: var(--mono, ui-monospace);
          font-size: 11px; letter-spacing: 0.04em;
        }
        .ob-lang-opt {
          appearance: none; border: 0; background: transparent;
          padding: 6px 12px; color: var(--ink-3, #6B6862);
          cursor: pointer; border-radius: 999px;
          transition: all .18s ease;
          font-family: inherit; font-size: inherit; line-height: 1;
        }
        .ob-lang span.ob-lang-opt { cursor: default; }
        .ob-lang-opt.active { background: var(--ink, #1F1E1D); color: var(--bg-elev, #FBF8F1); }
      `}</style>
    </form>
  )
}
