import type { SelectedMediaAsset } from './selector'
import { mediaKindFromMime, mediaKindLabel, type MediaKind } from './kind'

function countByKind(media: SelectedMediaAsset[]): Record<MediaKind, number> {
  const counts: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 }
  for (const m of media) {
    const kind = mediaKindFromMime(m.mimeType) ?? 'image'
    counts[kind] += 1
  }
  return counts
}

function summarize(counts: Record<MediaKind, number>): string {
  const parts = (['image', 'video', 'audio'] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${mediaKindLabel(k)}${counts[k] === 1 ? '' : 's'}`)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function buildMediaContextBlock(media: SelectedMediaAsset[]): string | null {
  if (media.length === 0) return null

  const lines = media.map((m) => {
    const label = mediaKindLabel(mediaKindFromMime(m.mimeType) ?? 'image')
    const desc = m.description?.trim()
    return desc ? `- [${label}] ${m.name} — ${desc}` : `- [${label}] ${m.name}`
  })
  const counts = countByKind(media)
  const hasAv = counts.video > 0 || counts.audio > 0

  return [
    '# Attached media',
    `${summarize(counts)} will be sent to the customer automatically right after your text reply:`,
    lines.join('\n'),
    '',
    'Acknowledge them briefly and naturally in your reply (e.g. "Here\'s proof from our clients", "Sinend ko po yung sample dito"). Do NOT describe each item in detail — the customer will see or hear it. Do NOT list filenames, slugs, or @/# tokens.',
    ...(hasAv
      ? [
          'For a voice message, tee it up the way a person would ("sinend ko po quick voice message para mas malinaw"). For a video, say what it shows in a few words ("here\'s a short video of how it works"). Never promise a voice message or video that is not listed above.',
        ]
      : []),
  ].join('\n')
}
