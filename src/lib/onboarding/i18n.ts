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

  'business.heading':       { tl: 'Mga detalye ng business mo',           en: 'About your business' },
  'business.subheading':    { tl: 'Mga ilang sagot lang para magagawa ng AI ang setup mo.', en: 'A few quick answers so AI can do the setup for you.' },
  'business.name.label':    { tl: 'Ano pangalan ng business mo?',         en: "What's your business name?" },
  'business.name.ph':       { tl: 'Hal. Aling Nena Bakery',               en: 'e.g. Aling Nena Bakery' },
  'business.offer.label':   { tl: 'Ano ang ineoffer mo sa isang pangungusap?', en: 'What do you offer, in one sentence?' },
  'business.offer.ph':      { tl: 'Hal. Sariwang ensaymada na ide-deliver araw-araw', en: 'e.g. Fresh ensaymada delivered daily' },
  'business.type.label':    { tl: 'Anong klase ng business?',             en: 'What type of business?' },
  'business.type.service':  { tl: 'Service',                              en: 'Service' },
  'business.type.ecom':     { tl: 'E-commerce',                           en: 'E-commerce' },
  'business.type.digital':  { tl: 'Digital product',                      en: 'Digital product' },
  'business.type.realestate':{ tl: 'Real estate',                         en: 'Real estate' },
  'business.audience.label':{ tl: 'Para kanino ang business mo?',         en: 'Who is this for?' },
  'business.audience.ph':   { tl: 'Hal. Mga tita sa Quezon City',         en: 'e.g. Tita-aged moms in Quezon City' },
  'business.pain.label':    { tl: 'Anong problema ang sinosolusyunan mo?', en: 'What pain are you solving for them?' },
  'business.pain.ph':       { tl: 'Hal. Gusto nila ng merienda pero walang oras magluto', en: "e.g. They want merienda but don't have time to bake" },
  'business.tone.label':    { tl: 'Anong tono ng bot mo?',                en: 'What tone should the bot use?' },
  'business.tone.friendly':     { tl: 'Friendly',     en: 'Friendly' },
  'business.tone.professional': { tl: 'Professional', en: 'Professional' },
  'business.tone.playful':      { tl: 'Playful',      en: 'Playful' },
  'business.tone.calm':         { tl: 'Calm',         en: 'Calm' },
  'business.save':          { tl: 'I-save at magpatuloy', en: 'Save and continue' },
  'business.saving':        { tl: 'Sini-save…',          en: 'Saving…' },

  'knowledge.heading':         { tl: 'Knowledge base ng business mo', en: 'Your business knowledge base' },
  'knowledge.subheading':      { tl: 'Sinulat ng AI based sa info mo. Pwede mong i-edit bago i-save.', en: 'AI drafted these from your answers. Edit anything before saving.' },
  'knowledge.section_title_ph':{ tl: 'Pamagat ng section',           en: 'Section title' },
  'knowledge.section_body_ph': { tl: 'Detalye…',                      en: 'Details…' },
  'knowledge.remove':          { tl: 'Tanggalin',                     en: 'Remove' },
  'knowledge.add_section':     { tl: '+ Magdagdag ng section',        en: '+ Add section' },
  'knowledge.save':            { tl: 'I-save ang knowledge',          en: 'Save knowledge' },
  'knowledge.saving':          { tl: 'Sini-save…',                    en: 'Saving…' },
  'knowledge.regenerate':      { tl: 'Mag-generate ulit',             en: 'Regenerate' },
  'knowledge.error':           { tl: 'May error sa pag-save. Subukan ulit.', en: 'Could not save. Try again.' },
  'knowledge.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
  'knowledge.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: "AI couldn't generate. Retry or skip." },
  'knowledge.generating':      { tl: 'Sini-sulat ng AI…',             en: 'AI is drafting…' },
  'knowledge.retry':           { tl: 'Subukan ulit',                  en: 'Retry' },

  'faqs.heading':         { tl: 'Mga FAQ ng business mo', en: 'Your FAQs' },
  'faqs.subheading':      { tl: 'Pinili ng AI base sa info mo. Alisin ang ayaw mo at magdagdag ng sarili.', en: "AI picked these from your info. Uncheck what you don't want and add your own." },
  'faqs.suggestion_label':{ tl: 'Mga suhestiyon',         en: 'AI suggestions' },
  'faqs.custom_label':    { tl: 'Idagdag mo pa',          en: 'Add your own' },
  'faqs.add':             { tl: '+ Magdagdag ng FAQ',     en: '+ Add FAQ' },
  'faqs.question_ph':     { tl: 'Tanong',                 en: 'Question' },
  'faqs.answer_ph':       { tl: 'Sagot',                  en: 'Answer' },
  'faqs.remove':          { tl: 'Tanggalin',              en: 'Remove' },
  'faqs.save':            { tl: 'I-save ang mga FAQ',     en: 'Save FAQs' },
  'faqs.saving':          { tl: 'Sini-save…',             en: 'Saving…' },
  'faqs.regenerate':      { tl: 'Mag-generate ulit',      en: 'Regenerate' },
  'faqs.generating':      { tl: 'Sini-sulat ng AI…',      en: 'AI is drafting…' },
  'faqs.error':           { tl: 'May error. Subukan ulit.', en: 'Could not save. Try again.' },
  'faqs.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
  'faqs.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: "AI couldn't generate. Retry or skip." },

  'personality.heading':       { tl: 'Personality ng bot mo',           en: "Your bot's personality" },
  'personality.subheading':    { tl: 'Pumili ng vibe at magbigay ng kaunting guidance — i-fill ng AI ang iba.', en: 'Pick a vibe and add a little guidance — AI fills in the rest.' },
  'personality.vibe.label':    { tl: 'Anong vibe ng bot mo?',           en: 'What vibe should the bot have?' },
  'personality.vibe.friendly_kuya_ate':       { tl: 'Friendly Kuya/Ate', en: 'Friendly Kuya/Ate' },
  'personality.vibe.professional_consultant': { tl: 'Professional',      en: 'Professional consultant' },
  'personality.vibe.hype_closer':             { tl: 'Hype Closer',       en: 'Hype closer' },
  'personality.vibe.calm_expert':             { tl: 'Calm Expert',       en: 'Calm expert' },
  'personality.greet.label':   { tl: 'Paano dapat bumati ang bot?',     en: 'How should the bot greet?' },
  'personality.greet.ph':      { tl: 'Hal. "Hi po! Welcome sa Aling Nena Bakery."', en: 'e.g. "Hi po! Welcome to Aling Nena Bakery."' },
  'personality.must_use.label':{ tl: 'Mga salita / phrases na dapat gamitin', en: 'Words or phrases it must always use' },
  'personality.must_use.ph':   { tl: 'Hal. "Sariwang luto araw-araw"',  en: 'e.g. "Baked fresh daily"' },
  'personality.must_not.label':{ tl: 'Mga bawal na sabihin',            en: 'What it must never do' },
  'personality.must_not.ph':   { tl: 'Hal. "Huwag mag-promise ng next-day delivery"', en: "e.g. \"Don't promise next-day delivery\"" },
  'personality.save':          { tl: 'I-save ang personality',          en: 'Save personality' },
  'personality.saving':        { tl: 'Sini-generate ng AI…',            en: 'AI is drafting…' },
  'personality.error':         { tl: 'May error. Subukan ulit o i-skip.', en: 'Could not save. Retry or skip.' },
  'personality.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
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
