// WhatStage University — provider reference parsing & normalization.
//
// Used by BOTH the CMS (client, live validity tick) and the write route handlers
// (server, never trust the client). We store NORMALIZED ids (not raw pasted URLs)
// so embed.ts can only ever build a known-good URL. ImageKit stores a file path
// (or canonical URL) which playback.ts signs server-side.
//
// No server-only imports here — safe in the browser bundle.

import type { VideoProvider } from './types'

export type ParsedRef = {
  providerVideoId: string | null
  providerHash: string | null
  sourcePath: string | null
}

export type ParseResult =
  | { ok: true; ref: ParsedRef }
  | { ok: false; error: string }

export const PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  imagekit: 'ImageKit',
}

export const PROVIDER_INPUT_HINTS: Record<VideoProvider, string> = {
  youtube: 'Paste a YouTube link (watch, youtu.be, shorts or embed) or the 11-character video ID.',
  vimeo: 'Paste a Vimeo link (incl. the private "/h" hash if unlisted) or the numeric video ID.',
  loom: 'Paste a Loom share or embed link, or the share ID.',
  imagekit: 'Paste the full ImageKit video URL (https://ik.imagekit.io/…) or its file path (/folder/file.mp4).',
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{1,15}$/
const VIMEO_HASH = /^[A-Za-z0-9]{1,40}$/
const LOOM_ID = /^[A-Za-z0-9]{8,64}$/

function tryUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function parseYouTube(raw: string): ParseResult {
  if (YOUTUBE_ID.test(raw)) {
    return { ok: true, ref: { providerVideoId: raw, providerHash: null, sourcePath: null } }
  }
  const url = tryUrl(raw)
  if (url) {
    const host = url.hostname.replace(/^www\./, '')
    let id: string | null = null
    if (host === 'youtu.be') {
      id = url.pathname.slice(1).split('/')[0] || null
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        id = url.searchParams.get('v')
      } else {
        const m = url.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?#]+)/)
        id = m ? m[1] : null
      }
    }
    if (id && YOUTUBE_ID.test(id)) {
      return { ok: true, ref: { providerVideoId: id, providerHash: null, sourcePath: null } }
    }
  }
  return { ok: false, error: 'Not a valid YouTube URL or 11-character video ID.' }
}

function parseVimeo(raw: string): ParseResult {
  if (VIMEO_ID.test(raw)) {
    return { ok: true, ref: { providerVideoId: raw, providerHash: null, sourcePath: null } }
  }
  const url = tryUrl(raw)
  if (url && url.hostname.replace(/^www\./, '').endsWith('vimeo.com')) {
    // /123456789  or  /123456789/abcdef123  or  /video/123456789
    const parts = url.pathname.split('/').filter(Boolean)
    const idIdx = parts.findIndex((p) => VIMEO_ID.test(p))
    if (idIdx !== -1) {
      const id = parts[idIdx]
      let hash: string | null = parts[idIdx + 1] && VIMEO_HASH.test(parts[idIdx + 1]) ? parts[idIdx + 1] : null
      const qh = url.searchParams.get('h')
      if (!hash && qh && VIMEO_HASH.test(qh)) hash = qh
      return { ok: true, ref: { providerVideoId: id, providerHash: hash, sourcePath: null } }
    }
  }
  return { ok: false, error: 'Not a valid Vimeo URL or numeric video ID.' }
}

function parseLoom(raw: string): ParseResult {
  if (LOOM_ID.test(raw) && !raw.includes('.')) {
    return { ok: true, ref: { providerVideoId: raw, providerHash: null, sourcePath: null } }
  }
  const url = tryUrl(raw)
  if (url && url.hostname.replace(/^www\./, '').endsWith('loom.com')) {
    const m = url.pathname.match(/\/(?:share|embed)\/([^/?#]+)/)
    const id = m ? m[1] : null
    if (id && LOOM_ID.test(id)) {
      return { ok: true, ref: { providerVideoId: id, providerHash: null, sourcePath: null } }
    }
  }
  return { ok: false, error: 'Not a valid Loom share/embed URL or ID.' }
}

function parseImageKit(raw: string): ParseResult {
  // Accept a full https URL or an absolute path. Reject anything else.
  if (raw.startsWith('/')) {
    if (raw.length > 1000) return { ok: false, error: 'ImageKit path is too long.' }
    return { ok: true, ref: { providerVideoId: null, providerHash: null, sourcePath: raw } }
  }
  const url = tryUrl(raw)
  if (url && url.protocol === 'https:' && url.hostname.length > 0) {
    if (raw.length > 1000) return { ok: false, error: 'ImageKit URL is too long.' }
    return { ok: true, ref: { providerVideoId: null, providerHash: null, sourcePath: raw } }
  }
  return { ok: false, error: 'Enter a full ImageKit https URL or a file path starting with "/".' }
}

/** Parse + validate a pasted reference into the columns we store. */
export function parseProviderRef(provider: VideoProvider, input: string): ParseResult {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter a video URL or ID.' }
  switch (provider) {
    case 'youtube':
      return parseYouTube(raw)
    case 'vimeo':
      return parseVimeo(raw)
    case 'loom':
      return parseLoom(raw)
    case 'imagekit':
      return parseImageKit(raw)
    default:
      return { ok: false, error: 'Unknown provider.' }
  }
}

/** True if the parse succeeds — convenience for the CMS live validity tick. */
export function isValidProviderRef(provider: VideoProvider, input: string): boolean {
  return parseProviderRef(provider, input).ok
}

/** Reconstruct a human-pasteable value from stored ids (for prefilling the CMS editor). */
export function formatProviderRef(provider: VideoProvider, ref: ParsedRef): string {
  switch (provider) {
    case 'youtube':
      return ref.providerVideoId ? `https://youtu.be/${ref.providerVideoId}` : ''
    case 'vimeo':
      if (!ref.providerVideoId) return ''
      return ref.providerHash
        ? `https://vimeo.com/${ref.providerVideoId}/${ref.providerHash}`
        : `https://vimeo.com/${ref.providerVideoId}`
    case 'loom':
      return ref.providerVideoId ? `https://www.loom.com/share/${ref.providerVideoId}` : ''
    case 'imagekit':
      return ref.sourcePath ?? ''
    default:
      return ''
  }
}
