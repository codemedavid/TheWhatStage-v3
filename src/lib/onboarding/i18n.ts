import type { OnboardingLang } from './types'

export const LANG_COOKIE = 'ws_onboarding_lang'

export const dict = {
  'shell.skip_for_now':         { tl: 'I-skip muna',          en: 'Skip for now' },
  'shell.skip_step':            { tl: 'I-skip ang step na ito', en: 'Skip this step' },
  'shell.back':                 { tl: 'Bumalik',              en: 'Back' },
  'shell.continue':             { tl: 'Magpatuloy',           en: 'Continue' },
  'shell.lang_toggle':          { tl: 'EN',                    en: 'TL' },
  'shell.progress':             { tl: 'Step {{n}} of {{total}}', en: 'Step {{n}} of {{total}}' },

  'welcome.title':              { tl: 'Tara, i-setup natin yung bot mo', en: "Let's set up your bot" },
  'welcome.body':               {
    tl: 'Maglalagay tayo ng kaunting info tungkol sa business mo, tapos sasagutan ng AI ang madaming detalye para sa iyo. Pwede mong i-skip ang kahit anong step.',
    en: "We'll capture a little about your business, and AI will fill in the rest. You can skip any step.",
  },
  'welcome.start':              { tl: 'Simulan na', en: 'Get started' },

  'done.title':                 { tl: 'Tapos na ang setup mo', en: 'Setup complete' },
  'done.body':                  {
    tl: 'Subukan mo na yung bot mo sa tester, o pumunta sa dashboard.',
    en: 'Try your bot in the tester, or jump into the dashboard.',
  },
  'done.open_tester':           { tl: 'Buksan ang tester',  en: 'Open chatbot tester' },
  'done.go_dashboard':          { tl: 'Pumunta sa dashboard', en: 'Go to dashboard' },

  'checklist.title':            { tl: 'I-launch ang account mo',    en: 'Launch your account' },
  'checklist.business':         { tl: 'Mga detalye ng business',    en: 'Business basics' },
  'checklist.knowledge':        { tl: 'Knowledge base',             en: 'Knowledge base' },
  'checklist.faqs':             { tl: 'Mga FAQ',                    en: 'FAQs' },
  'checklist.personality':      { tl: 'Personality ng bot',         en: 'Bot personality' },
  'checklist.goal':             { tl: 'Pangunahing goal',           en: 'Primary goal' },
  'checklist.goal_content':     { tl: 'Detalye ng action page',     en: 'Action page content' },
  'checklist.flow':             { tl: 'Daloy ng usapan',            en: 'Conversation flow' },
  'checklist.dismiss':          { tl: 'Itago ang checklist',        en: 'Hide checklist' },
  'checklist.resume':           { tl: 'Ituloy',                     en: 'Resume' },
  'checklist.start':            { tl: 'Simulan',                    en: 'Start' },

  'stub.title':                 { tl: 'Step na ito ay paparating pa', en: 'This step is coming soon' },
  'stub.body':                  {
    tl: 'I-skip muna ito at magpapatuloy tayo sa susunod na step.',
    en: "Skip this for now — we'll continue to the next step.",
  },
} as const

export type DictKey = keyof typeof dict

export function t(key: DictKey, lang: OnboardingLang, vars: Record<string, string | number> = {}): string {
  let s: string = dict[key][lang]
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{{${k}}}`, String(v))
  }
  return s
}

export function readLangFromCookie(value: string | undefined): OnboardingLang {
  return value === 'en' ? 'en' : 'tl'
}
