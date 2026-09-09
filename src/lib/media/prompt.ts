import type { SelectedMediaAsset } from './selector'
import { mediaKindFromMime, mediaKindLabel, type MediaKind } from './kind'

/**
 * How the block frames the listed media:
 *  - 'candidates': the reply model picks per item via `attach_media` (the
 *    structured classify path). Nothing is sent unless picked.
 *  - 'auto': the items WILL be sent right after the reply (the plain `answer()`
 *    path, which has no structured decision and only ever carries
 *    operator-tagged knowledge refs).
 */
export type MediaBlockMode = 'candidates' | 'auto'

function countByKind(media: SelectedMediaAsset[]): Record<MediaKind, number> {
  return media.reduce<Record<MediaKind, number>>(
    (acc, m) => {
      const kind = mediaKindFromMime(m.mimeType) ?? 'image'
      return { ...acc, [kind]: acc[kind] + 1 }
    },
    { image: 0, video: 0, audio: 0 },
  )
}

function summarize(counts: Record<MediaKind, number>): string {
  const parts = (['image', 'video', 'audio'] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${mediaKindLabel(k)}${counts[k] === 1 ? '' : 's'}`)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function describeLine(m: SelectedMediaAsset, withId: boolean): string {
  const label = mediaKindLabel(mediaKindFromMime(m.mimeType) ?? 'image')
  const desc = m.description?.trim()
  const head = withId ? `- id: ${m.slug} · [${label}] ${m.name}` : `- [${label}] ${m.name}`
  return desc ? `${head} — ${desc}` : head
}

const AV_TEE_UP =
  'For a voice message, tee it up the way a person would ("sinend ko po quick voice message para mas malinaw"). For a video, say what it shows in a few words ("here\'s a short video of how it works"). Never promise a voice message or video that is not listed above.'

function candidatesBlock(media: SelectedMediaAsset[], hasAv: boolean): string {
  return [
    '# Media candidates',
    `${summarize(countByKind(media))} from the media library COULD be sent right after your text reply. These are candidates only — NOTHING is sent unless you list its id in \`attach_media\`:`,
    media.map((m) => describeLine(m, true)).join('\n'),
    '',
    'Pick ONLY the items that directly answer or support THIS message (match the customer\'s ask against each item\'s name and description). Usually that is zero or one item; never pick something just because it is listed. Leave `attach_media` empty for greetings, qualifying questions, scheduling, objections, or anything where the item would feel random.',
    'Briefly and naturally acknowledge the items you picked (e.g. "Here\'s proof from our clients", "Sinend ko po yung sample dito"). Do NOT mention or hint at items you did not pick. Do NOT describe them in detail, and do NOT list filenames, slugs, ids, or @/# tokens in `reply`.',
    ...(hasAv ? [AV_TEE_UP] : []),
  ].join('\n')
}

function autoBlock(media: SelectedMediaAsset[], hasAv: boolean): string {
  return [
    '# Attached media',
    `${summarize(countByKind(media))} will be sent to the customer automatically right after your text reply:`,
    media.map((m) => describeLine(m, false)).join('\n'),
    '',
    'Acknowledge them briefly and naturally in your reply (e.g. "Here\'s proof from our clients", "Sinend ko po yung sample dito"). Do NOT describe each item in detail — the customer will see or hear it. Do NOT list filenames, slugs, or @/# tokens.',
    ...(hasAv ? [AV_TEE_UP] : []),
  ].join('\n')
}

export function buildMediaContextBlock(
  media: SelectedMediaAsset[],
  mode: MediaBlockMode = 'auto',
): string | null {
  if (media.length === 0) return null
  const counts = countByKind(media)
  const hasAv = counts.video > 0 || counts.audio > 0
  return mode === 'candidates' ? candidatesBlock(media, hasAv) : autoBlock(media, hasAv)
}
