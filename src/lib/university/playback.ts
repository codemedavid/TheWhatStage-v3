// WhatStage University — lesson playback resolution (server-only).
//
// The ONLY path from a lesson to a playable source. Calls the security-definer
// get_lesson_playback RPC under the caller's auth (cookie-bound anon client), so
// the DB re-checks entitlement and returns an empty set when the viewer isn't
// allowed. We then turn the source into a ready embed URL or a short-lived signed
// URL — the raw provider id / imagekit path NEVER reaches the client.

import { createClient } from '@/lib/supabase/server'
import { getImageKit } from '@/lib/imagekit/server'
import { buildEmbedUrl } from './embed'
import type { LessonPlayback, VideoProvider } from './types'

const IMAGEKIT_EXPIRE_SECONDS = 1800 // 30 min signed URL

type PlaybackRow = {
  lesson_id: string
  provider: VideoProvider
  provider_video_id: string | null
  provider_hash: string | null
  source_path: string | null
}

export async function getLessonPlayback(lessonId: string): Promise<LessonPlayback | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_lesson_playback', { p_lesson_id: lessonId })
  if (error) {
    console.error('[university.playback] get_lesson_playback failed', { lessonId, error: error.message })
    return null
  }
  const rows = (data ?? []) as PlaybackRow[]
  const row = rows[0]
  if (!row) return null // unknown lesson OR not entitled — indistinguishable by design

  if (row.provider === 'imagekit') {
    const path = row.source_path
    if (!path) return null
    try {
      const ik = getImageKit()
      const signedUrl = path.startsWith('http')
        ? ik.url({ src: path, signed: true, expireSeconds: IMAGEKIT_EXPIRE_SECONDS })
        : ik.url({ path, signed: true, expireSeconds: IMAGEKIT_EXPIRE_SECONDS })
      const expiresAt = new Date(Date.now() + IMAGEKIT_EXPIRE_SECONDS * 1000).toISOString()
      return { kind: 'file', provider: 'imagekit', signedUrl, expiresAt }
    } catch (e) {
      console.error('[university.playback] imagekit signing failed', { lessonId, error: e })
      return null
    }
  }

  const embedUrl = buildEmbedUrl(row.provider, {
    videoId: row.provider_video_id,
    hash: row.provider_hash,
  })
  if (!embedUrl) return null
  return { kind: 'embed', provider: row.provider as 'youtube' | 'vimeo' | 'loom', embedUrl }
}
