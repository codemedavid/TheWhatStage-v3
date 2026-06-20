// src/lib/messenger/action-page-card.ts
//
// Shared resolution for the action-page button-template card — the caption shown
// ABOVE the button and the short label shown ON the button. Used by both send
// paths so the card behaves consistently:
//   - live chat:  classify.ts -> app/api/messenger/process/route.ts
//   - follow-ups: generateCta.ts -> lib/followups/fire.ts
//
// Two rules the card must always honor:
//  1. The caption must GUIDE the lead on what to do next. It must never fall back
//     to the action-page title (that produced the generic "<Page> fill up form"
//     card). When the model omits a caption we use a guiding default instead.
//  2. The caption renders in Messenger's button-template font as-is, so it must be
//     plain, natural text — no markdown emphasis (**bold**, *italic*, __bold__) and
//     no wrapping quotes the model sometimes adds. Emoji and Tagalog hyphens
//     ("I-claim", "mag-book") are preserved.

// Messenger hard caps: button-template body 640 chars, button title 20 chars.
const CAPTION_MAX = 640
const LABEL_MAX = 20

// Guiding fallback caption used when the model returns no caption. Walks the lead
// through the next step rather than naming the page.
export const GUIDING_DEFAULT_CAPTION =
  'Tap the button below 👇 then fill out the quick form to continue.'

// Flatten to one line, drop surrounding quotes, strip markdown emphasis. Keeps
// emoji and in-word hyphens; only removes paired emphasis markers.
export function cleanCardCaption(input: unknown): string {
  if (typeof input !== 'string') return ''
  let s = input.replace(/\s+/g, ' ').trim()
  // Surrounding straight or smart quotes.
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  // Paired markdown emphasis: **bold**, *italic*, __bold__.
  s = s.replace(/\*\*(.+?)\*\*/g, '$1')
  s = s.replace(/\*(.+?)\*/g, '$1')
  s = s.replace(/__(.+?)__/g, '$1')
  return s.trim()
}

// Resolve the caption shown above the button. Never the page title — an empty or
// missing AI caption falls back to the guiding default.
export function resolveCardCaption(aiCaption: unknown, maxLen: number = CAPTION_MAX): string {
  const cleaned = cleanCardCaption(aiCaption)
  return (cleaned || GUIDING_DEFAULT_CAPTION).slice(0, maxLen)
}

// Resolve the button label. Prefer the AI label, then the page's configured
// cta_label, then a neutral default. Never the page title.
export function resolveCardLabel(
  aiLabel: unknown,
  configuredLabel: string | null | undefined,
  maxLen: number = LABEL_MAX,
): string {
  const ai = typeof aiLabel === 'string' ? aiLabel.trim() : ''
  const configured = (configuredLabel ?? '').trim()
  return (ai || configured || 'Open').slice(0, maxLen)
}
