import Link from 'next/link'
import { Suspense } from 'react'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'
import { getSession } from '@/lib/auth/get-session'
import type { OnboardingLang } from '@/lib/onboarding/types'
import './welcome.css'

export default async function WelcomePage() {
  const lang = await getOnboardingLang()

  const eyebrow = lang === 'tl' ? 'Tara, i-set up natin' : "Let's set you up"
  const hello = lang === 'tl' ? 'Kumusta,' : 'Welcome,'
  const takes = lang === 'tl' ? '~5 min · pwedeng i-skip ang lahat' : '~5 min · everything is skippable'
  const noteEyebrow = lang === 'tl' ? 'Mensahe galing kay Niño' : 'A note from Niño'
  const noteBody =
    lang === 'tl'
      ? 'Para sa mga maliliit na negosyo — para hindi mo na kailangang sagutin ang kada Messenger DM sa madaling araw.'
      : "Built for small businesses — so you don't have to answer every Messenger DM at 2am."
  const noteTitle = lang === 'tl' ? 'Founder · WhatStage' : 'Founder · WhatStage'
  const stamp = lang === 'tl' ? 'Made in PH' : 'Made in PH'

  return (
    <WizardShell lang={lang} step={null} terminal="welcome">
      <section className="ob-welcome">
        <div className="ob-welcome-left">
          <div className="ob-welcome-pill">
            <span className="ob-welcome-pill-num">00</span>
            <span className="ob-welcome-pill-label">{eyebrow}</span>
          </div>
          <h1 className="ob-welcome-h1">
            {hello}{' '}
            <Suspense fallback={<em>{lang === 'tl' ? 'Ka-WhatStage' : 'there'}.</em>}>
              <FirstName lang={lang} />
            </Suspense>
          </h1>
          <p className="ob-welcome-lede">{t('welcome.body', lang)}</p>
          <div className="ob-welcome-cta">
            <Link href="/onboarding/business" className="ob-btn ob-btn-primary ob-btn-lg">
              {t('welcome.start', lang)}
              <Arrow />
            </Link>
            <span className="ob-welcome-meta">{takes}</span>
          </div>
        </div>

        <aside className="ob-welcome-right">
          <div className="ob-note">
            <div className="ob-note-eyebrow">{noteEyebrow}</div>
            <p className="ob-note-body">{noteBody}</p>
            <div className="ob-note-sign">
              <div className="ob-note-avatar">N</div>
              <div className="ob-note-meta">
                <div className="ob-note-name">Niño</div>
                <div className="ob-note-title">{noteTitle}</div>
              </div>
              <span className="ob-note-stamp">{stamp}</span>
            </div>
          </div>
        </aside>
      </section>
    </WizardShell>
  )
}

async function FirstName({ lang }: { lang: OnboardingLang }) {
  const session = await getSession()
  const fallback = lang === 'tl' ? 'Ka-WhatStage' : 'there'
  const firstName = (session?.fullName || '').trim().split(' ')[0] || fallback
  return <em>{firstName}.</em>
}

function Arrow() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}
