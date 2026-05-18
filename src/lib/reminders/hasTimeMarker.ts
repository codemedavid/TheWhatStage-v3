// Cheap regex pre-filter that decides whether to spend an LLM call on
// `extractReminder`. False positives are fine (extractReminder will say no);
// false negatives are the failure mode we care about — be permissive.

const TIME_WORD_RE = new RegExp(
  [
    // English weekdays
    '\\b(mon|tue|wed|thu|fri|sat|sun)(day)?\\b',
    // Tagalog/Taglish weekdays
    '\\b(lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo)\\b',
    // English months
    '\\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\\b',
    // Tagalog months
    '\\b(enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)\\b',
    // Relative time words
    '\\b(today|tonight|tomorrow|tonite|later|tom|ngayon|bukas|mamaya|kanina|kahapon|kungelan|kelan|kailan)\\b',
    // Tagalog "next/this" markers used with time
    '\\b(next|this|sa|nung|noong)\\s+(week|weekend|month|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo|umaga|hapon|gabi|tanghali)\\b',
    // Time of day phrases (Tagalog)
    '\\b(umaga|hapon|gabi|tanghali|madaling\\s+araw)\\b',
    // Numeric clock times: "2pm", "3:30", "14:30", "at 9"
    '\\b\\d{1,2}\\s*(am|pm)\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
    '\\b(at|by|sa|alas)\\s+\\d{1,2}\\b',
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
