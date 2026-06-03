// WhatStage University — provider embed URL builder.
//
// The SINGLE place where a stored provider id becomes a playable URL. Pure and
// unit-tested. We only ever build URLs from NORMALIZED ids (validated by
// providers.ts before storage), so we never render an attacker-controlled URL.
// ImageKit returns null here — its playback is a signed <video> URL minted in
// playback.ts, not an iframe embed.

import type { VideoProvider } from './types'

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{1,15}$/
const VIMEO_HASH = /^[A-Za-z0-9]{1,40}$/
const LOOM_ID = /^[A-Za-z0-9]{8,64}$/

export function buildEmbedUrl(
  provider: VideoProvider,
  ref: { videoId: string | null; hash?: string | null },
): string | null {
  const id = ref.videoId?.trim() ?? ''
  switch (provider) {
    case 'youtube':
      if (!YOUTUBE_ID.test(id)) return null
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`
    case 'vimeo': {
      if (!VIMEO_ID.test(id)) return null
      const hash = ref.hash?.trim() ?? ''
      return VIMEO_HASH.test(hash)
        ? `https://player.vimeo.com/video/${id}?h=${hash}`
        : `https://player.vimeo.com/video/${id}`
    }
    case 'loom':
      if (!LOOM_ID.test(id)) return null
      return `https://www.loom.com/embed/${id}`
    case 'imagekit':
      return null
    default:
      return null
  }
}
