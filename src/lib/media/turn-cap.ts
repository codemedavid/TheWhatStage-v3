import { mediaKindFromMime } from './kind'

// One voice/video per turn keeps the bot from stacking heavy bubbles; images
// still share the caller's total cap. Candidates arrive in priority order.
export const MAX_AV_PER_TURN = 1

export function capMediaPerTurn<T extends { mimeType: string }>(
  candidates: readonly T[],
  opts: { maxTotal: number; maxAv?: number },
): T[] {
  const maxAv = opts.maxAv ?? MAX_AV_PER_TURN
  const out: T[] = []
  let avCount = 0
  for (const c of candidates) {
    if (out.length >= opts.maxTotal) break
    const kind = mediaKindFromMime(c.mimeType)
    const isAv = kind === 'video' || kind === 'audio'
    if (isAv) {
      if (avCount >= maxAv) continue
      avCount += 1
    }
    out.push(c)
  }
  return out
}
