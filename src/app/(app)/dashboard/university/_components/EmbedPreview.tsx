'use client'

import { parseProviderRef } from '@/lib/university/providers'
import { buildEmbedUrl } from '@/lib/university/embed'
import type { VideoProvider } from '@/lib/university/types'

interface Props {
  provider: VideoProvider
  providerInput: string
}

/**
 * Live CMS preview for the focused lesson row. For youtube/vimeo/loom we parse
 * the pasted ref → normalized ids → a known-good embed URL and mount an iframe.
 * ImageKit can't be previewed in the CMS (its playback is a signed URL minted
 * server-side at watch time), so we show a calm placeholder. Invalid input →
 * muted "Enter a valid link". The iframe only mounts here — the parent decides
 * whether to render this component at all (lazy: focused row only).
 */
export function EmbedPreview({ provider, providerInput }: Props) {
  const parsed = parseProviderRef(provider, providerInput)

  if (!parsed.ok) {
    return (
      <div className="uni-embed-preview" data-state="empty">
        <PlaceholderNote text="Enter a valid link to preview the video." muted />
      </div>
    )
  }

  if (provider === 'imagekit') {
    return (
      <div className="uni-embed-preview" data-state="imagekit">
        <PlaceholderNote text="Signed preview isn't available in the editor — this video will play for entitled viewers." />
      </div>
    )
  }

  const embedUrl = buildEmbedUrl(provider, {
    videoId: parsed.ref.providerVideoId,
    hash: parsed.ref.providerHash,
  })

  if (!embedUrl) {
    return (
      <div className="uni-embed-preview" data-state="empty">
        <PlaceholderNote text="Enter a valid link to preview the video." muted />
      </div>
    )
  }

  return (
    <div className="uni-embed-preview" data-state="embed">
      <iframe
        src={embedUrl}
        title="Lesson video preview"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}

function PlaceholderNote({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
        height: '100%',
        padding: '0 24px',
        textAlign: 'center',
        color: muted ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.78)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <PlayGlyph />
      <span>{text}</span>
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      stroke="currentColor"
      strokeWidth={1.75}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.85 }}
    >
      <circle cx="12" cy="12" r="9.25" />
      <path d="M10 8.5 16 12l-6 3.5V8.5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
