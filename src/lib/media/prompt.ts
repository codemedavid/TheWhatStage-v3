import type { SelectedMediaAsset } from './selector'

export function buildMediaContextBlock(media: SelectedMediaAsset[]): string | null {
  if (media.length === 0) return null

  const lines = media.map((m) => {
    const desc = m.description?.trim()
    return desc ? `- ${m.name} — ${desc}` : `- ${m.name}`
  })

  const noun = media.length === 1 ? 'image' : `${media.length} images`
  return [
    '# Attached images',
    `${noun} will be sent to the customer automatically right after your text reply:`,
    lines.join('\n'),
    '',
    'Acknowledge them briefly and naturally in your reply (e.g. "Here\'s proof from our clients", "Kita mo po dito sa mga screenshots"). Do NOT describe each image in detail — the customer will see them. Do NOT list filenames, slugs, or @/# tokens.',
  ].join('\n')
}
