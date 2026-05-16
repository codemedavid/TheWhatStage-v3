import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'
import { getSession } from '@/lib/auth/get-session'

export default async function WelcomePage() {
  const [lang, session] = await Promise.all([getOnboardingLang(), getSession()])
  const firstName = (session?.fullName || '').trim().split(' ')[0] || (lang === 'tl' ? 'Ka-WhatStage' : 'there')

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
    <WizardShell lang={lang} step={null}>
      <section className="ob-welcome">
        <div className="ob-welcome-left">
          <div className="ob-welcome-pill">
            <span className="ob-welcome-pill-num">00</span>
            <span className="ob-welcome-pill-label">{eyebrow}</span>
          </div>
          <h1 className="ob-welcome-h1">
            {hello} <em>{firstName}.</em>
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

      <style>{WELCOME_CSS}</style>
    </WizardShell>
  )
}

function Arrow() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

const WELCOME_CSS = `
.ob-shell .ob-welcome {
  display: grid; grid-template-columns: 1.25fr 1fr;
  gap: 80px; align-items: center;
}
.ob-shell .ob-welcome-left { padding-right: 8px; max-width: 540px; }
.ob-shell .ob-welcome-pill {
  display: inline-flex; align-items: center; gap: 10px;
  margin-bottom: 32px;
  padding: 5px 14px 5px 5px;
  background: color-mix(in oklab, var(--accent-soft) 60%, transparent);
  border-radius: 999px;
}
.ob-shell .ob-welcome-pill-num {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.12em; color: var(--accent);
  background: var(--paper); padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--accent) 25%, transparent);
}
.ob-shell .ob-welcome-pill-label {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--accent-ink);
}
.ob-shell .ob-welcome-h1 {
  font-family: var(--serif); font-weight: 400;
  font-size: clamp(48px, 6vw, 84px);
  line-height: 1.02; margin: 0 0 28px;
  letter-spacing: -0.025em;
}
.ob-shell .ob-welcome-h1 em { font-style: italic; color: var(--accent-ink); }
.ob-shell .ob-welcome-lede {
  font-size: 17px; line-height: 1.55;
  color: var(--ink-2); max-width: 460px;
  margin: 0 0 36px;
}
.ob-shell .ob-welcome-cta {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
}
.ob-shell .ob-welcome-meta {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3);
  white-space: nowrap;
}

.ob-shell .ob-note {
  background: var(--paper); border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 28px 28px 22px; max-width: 380px;
  margin-left: auto; position: relative;
  box-shadow: 0 1px 2px rgba(31,30,29,0.04);
}
.ob-shell .ob-note::before {
  content: '“'; position: absolute; top: 6px; left: 18px;
  font-family: var(--serif); font-size: 80px;
  color: var(--accent-soft); line-height: 1; z-index: 0;
}
.ob-shell .ob-note-eyebrow {
  font-family: var(--mono); font-size: 10.5px;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 14px; position: relative;
}
.ob-shell .ob-note-body {
  font-family: var(--serif); font-size: 22px;
  line-height: 1.35; color: var(--ink);
  margin: 0 0 24px; letter-spacing: -0.005em; position: relative;
}
.ob-shell .ob-note-sign {
  display: flex; align-items: center; gap: 12px;
  padding-top: 14px; border-top: 1px solid var(--line);
  position: relative;
}
.ob-shell .ob-note-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent-ink);
  display: grid; place-items: center;
  font-family: var(--serif); font-size: 18px;
}
.ob-shell .ob-note-meta { display: flex; flex-direction: column; line-height: 1.25; }
.ob-shell .ob-note-name { font-weight: 500; font-size: 14px; }
.ob-shell .ob-note-title {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; color: var(--ink-3);
}
.ob-shell .ob-note-stamp {
  margin-left: auto;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--accent-ink);
  padding: 4px 8px;
  border: 1px dashed color-mix(in oklab, var(--accent) 40%, transparent);
  border-radius: 6px;
}

@media (max-width: 880px) {
  .ob-shell .ob-welcome { grid-template-columns: 1fr; gap: 36px; }
  .ob-shell .ob-note { margin-left: 0; }
}
`
