// src/app/(app)/dashboard/_components/LaunchChecklist.tsx
import Link from 'next/link'
import { getOnboardingState } from '@/lib/onboarding/state'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import { dismissOnboardingAction } from '@/app/(app)/onboarding/actions'

export async function LaunchChecklist() {
  const [state, lang] = await Promise.all([getOnboardingState(), getOnboardingLang()])
  if (!state) return null
  if (state.completed_at || state.dismissed_at) return null

  return (
    <section
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-5"
      aria-labelledby="launch-checklist-title"
    >
      <div className="flex items-center justify-between">
        <h2 id="launch-checklist-title" className="text-sm font-semibold text-emerald-900">
          {t('checklist.title', lang)}
        </h2>
        <form action={dismissOnboardingAction}>
          <button type="submit" className="text-xs text-emerald-700 hover:text-emerald-900">
            {t('checklist.dismiss', lang)}
          </button>
        </form>
      </div>

      <ul className="mt-3 divide-y divide-emerald-100">
        {STEP_ORDER.map((meta) => {
          const done = meta.isComplete(state)
          return (
            <li key={meta.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                    done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-zinc-300 bg-white'
                  }`}
                >
                  {done ? '✓' : ''}
                </span>
                <span className={done ? 'text-zinc-500 line-through' : 'text-zinc-900'}>
                  {t(meta.labelKey as DictKey, lang)}
                </span>
              </span>
              <Link
                href={meta.route}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
              >
                {done ? t('checklist.resume', lang) : t('checklist.start', lang)}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
