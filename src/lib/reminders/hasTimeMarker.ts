// Cheap regex pre-filter that decides whether to spend an LLM call on
// `extractReminder`. False positives are fine (extractReminder will say no);
// false negatives are the failure mode we care about — be permissive.

const TIME_WORD_RE = new RegExp(
  [
    // English weekdays
    '\\b(mon|tue|wed|thu|fri|sat|sun)(day)?\\b',
    // Tagalog/Taglish weekdays
    '\\b(lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo)\\b',
    // English months — long forms (note: "may" excluded; the long form IS "may")
    '\\b(january|february|march|april|june|july|august|september|october|november|december)\\b',
    // English months — short forms require a date number following (drops bare "may")
    '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep(?:t(?:ember)?)?|oct|nov|dec)\\b\\.?\\s+\\d',
    // Tagalog months
    '\\b(enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)\\b',
    // Relative time words
    '\\b(today|tonight|tomorrow|tonite|later|tom|ngayon|bukas|mamaya|kanina|kahapon|kelan|kailan)\\b',
    // "next/this/nung/noong" + time word (week/weekend/month/weekday/time-of-day)
    '\\b(next|this|nung|noong)\\s+(week|weekend|month|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo|umaga|hapon|gabi|tanghali)\\b',
    // "sa" only counts when followed by a recognized time word (weekday/time-of-day), not a bare digit
    '\\bsa\\s+(umaga|hapon|gabi|tanghali|lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekend|month)\\b',
    // Time-of-day only counts when paired with a relative qualifier
    '\\b(mamayang|kaninang|kanina\\s+lang|bukas|sa|next|this)\\s+(umaga|hapon|gabi|tanghali|madaling\\s+araw)\\b',
    // Numeric clock times: "2pm", "3:30", "14:30"
    '\\b\\d{1,2}\\s*(am|pm)\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
    // English/Spanish-loaned clock markers require AM/PM or colon-minutes after the number
    '\\b(at|by)\\s+\\d{1,2}(\\s*(am|pm)|:\\d{2})\\b',
    // "alas <digit>" is unambiguous Tagalog clock time (alas tres, alas singko)
    '\\balas\\s+\\d{1,2}\\b',
    // "follow up", "ping me back", "message me later", "chat me back"
    '\\b(follow\\s*up|ping\\s+me|chat\\s+me|message\\s+me|hit\\s+me\\s+up|reach\\s+out|kausapin|tawagan|balikan|balik\\s+mo)\\b',
  ].join('|'),
  'i',
)

export function hasTimeMarker(text: string): boolean {
  const t = text?.trim() ?? ''
  if (t.length < 3) return false
  return TIME_WORD_RE.test(t)
}
