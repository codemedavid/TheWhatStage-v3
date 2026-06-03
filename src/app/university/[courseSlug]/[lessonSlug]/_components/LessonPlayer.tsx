'use client'

// WhatStage University — the lesson player (§3.9). Renders one stage:
//   kind:'file'  (imagekit) → native <video>, resume-seek + "Resuming…" toast,
//                             throttled progress writes (≤1/10s), auto-complete ≥90%.
//   kind:'embed' (yt/vimeo/loom) → <iframe> in the 16:9 stage; progress is the
//                             explicit "Mark complete" button (+ start-time hint).
// "Mark complete" and "Mark complete & next →" are always shown (disabled with a
// hint when !canTrack). Best-effort, never throws into playback.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { LessonPlayback } from '@/lib/university/types'
import { saveProgressAction, markLessonCompleteAction } from '@/app/university/actions'

type Props = {
  playback: LessonPlayback
  resumeSeconds: number
  lessonId: string
  canTrack: boolean
  alreadyComplete: boolean
  nextHref: string | null
  /** Where the last lesson's "finish" control goes (the course detail page). */
  finishHref: string
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** For youtube/vimeo embeds we may append a start time so the iframe resumes. */
function withStartTime(playback: Extract<LessonPlayback, { kind: 'embed' }>, resumeSeconds: number): string {
  if (resumeSeconds <= 0) return playback.embedUrl
  try {
    const url = new URL(playback.embedUrl)
    if (playback.provider === 'youtube') url.searchParams.set('start', String(Math.floor(resumeSeconds)))
    else if (playback.provider === 'vimeo') url.hash = `t=${Math.floor(resumeSeconds)}s`
    return url.toString()
  } catch {
    return playback.embedUrl
  }
}

export function LessonPlayer({
  playback,
  resumeSeconds,
  lessonId,
  canTrack,
  alreadyComplete,
  nextHref,
  finishHref,
}: Props) {
  const router = useRouter()
  // When an imagekit signed URL errors or nears expiry, re-request a fresh one
  // by re-running the RSC (which re-signs via getLessonPlayback).
  const reloadPlayback = useCallback(() => {
    router.refresh()
  }, [router])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastSaveRef = useRef(0)
  const completedRef = useRef(alreadyComplete)
  const didSeekRef = useRef(false)

  const [completed, setCompleted] = useState(alreadyComplete)
  const [pending, setPending] = useState<null | 'complete' | 'next'>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [resumeToast, setResumeToast] = useState<number | null>(resumeSeconds > 0 ? resumeSeconds : null)
  const [embedError, setEmbedError] = useState(false)

  // ── progress write (throttled to ≤1 / 10s for native video) ──
  const flushProgress = useCallback(
    (seconds: number, force = false) => {
      if (!canTrack) return
      const now = Date.now()
      if (!force && now - lastSaveRef.current < 10_000) return
      lastSaveRef.current = now
      void saveProgressAction({ lessonId, resumeSeconds: Math.floor(seconds) }).then((r) => {
        if (!r.ok) {
          // silent — the parent re-checks on the next navigation; surface only on
          // repeated user-initiated actions.
        }
      })
    },
    [canTrack, lessonId],
  )

  const doComplete = useCallback(
    async (then: 'stay' | 'next') => {
      if (!canTrack) {
        setToast('Log in to track your progress.')
        return
      }
      setPending(then === 'next' ? 'next' : 'complete')
      // optimistic
      setCompleted(true)
      completedRef.current = true
      const res = await markLessonCompleteAction({ lessonId })
      setPending(null)
      if (!res.ok) {
        setCompleted(alreadyComplete)
        completedRef.current = alreadyComplete
        setToast('We couldn’t save — check your connection.')
        return
      }
      if (then === 'next' && nextHref) {
        router.push(nextHref)
      } else {
        router.refresh()
      }
    },
    [canTrack, lessonId, nextHref, alreadyComplete, router],
  )

  // ── native <video> resume + progress wiring ──
  useEffect(() => {
    const v = videoRef.current
    if (!v || playback.kind !== 'file') return

    const onLoaded = () => {
      if (!didSeekRef.current && resumeSeconds > 0 && resumeSeconds < (v.duration || Infinity)) {
        didSeekRef.current = true
        try {
          v.currentTime = resumeSeconds
        } catch {
          /* ignore */
        }
      }
    }
    const onTime = () => {
      flushProgress(v.currentTime)
      if (!completedRef.current && v.duration > 0 && v.currentTime / v.duration >= 0.9) {
        completedRef.current = true
        setCompleted(true)
        if (canTrack) {
          void markLessonCompleteAction({ lessonId }).then((res) => {
            if (!res.ok) {
              // roll back the optimistic badge; the next timeupdate retries
              completedRef.current = alreadyComplete
              setCompleted(alreadyComplete)
            }
          })
        }
      }
    }
    const onPause = () => flushProgress(v.currentTime, true)
    const onEnded = () => flushProgress(v.currentTime, true)

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onEnded)
    }
  }, [playback, resumeSeconds, flushProgress, canTrack, lessonId, alreadyComplete])

  // flush on tab hide / unload
  useEffect(() => {
    if (playback.kind !== 'file' || !canTrack) return
    const onHide = () => {
      const v = videoRef.current
      if (v) flushProgress(v.currentTime, true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
    }
  }, [playback, canTrack, flushProgress])

  // auto-dismiss the resume toast after 4s
  useEffect(() => {
    if (resumeToast == null) return
    const t = setTimeout(() => setResumeToast(null), 4000)
    return () => clearTimeout(t)
  }, [resumeToast])

  // auto-dismiss generic toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const startOver = () => {
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = 0
      } catch {
        /* ignore */
      }
    }
    setResumeToast(null)
    if (canTrack) flushProgress(0, true)
  }

  return (
    <div>
      {/* stage */}
      <div style={{ position: 'relative' }}>
        {embedError && playback.kind === 'embed' ? (
          <div className="uni-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
            <div style={{ color: 'var(--uni-ink-invert)', maxWidth: 360 }}>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#fff' }}>We couldn’t load this video.</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button type="button" onClick={() => setEmbedError(false)} className="uni-btn uni-btn-sm uni-focus" style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : playback.kind === 'file' ? (
          <div className="uni-stage">
            <video
              ref={videoRef}
              src={playback.signedUrl}
              controls
              preload="metadata"
              playsInline
              onError={reloadPlayback}
            />
          </div>
        ) : (
          <div className="uni-stage">
            <iframe
              src={withStartTime(playback, resumeSeconds)}
              title="Lesson video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              onError={() => setEmbedError(true)}
            />
          </div>
        )}

        {/* resume toast (native video only) */}
        {resumeToast != null && playback.kind === 'file' ? (
          <div
            role="status"
            style={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'rgba(20,18,12,0.86)',
              color: '#fff',
              borderRadius: 'var(--uni-r-sm)',
              padding: '8px 12px',
              fontSize: 13,
              boxShadow: 'var(--uni-shadow-md)',
            }}
          >
            Resuming from {fmt(resumeToast)}
            <button type="button" onClick={startOver} className="uni-focus" style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
              Start over
            </button>
          </div>
        ) : null}
      </div>

      {/* complete actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18, alignItems: 'center' }}>
        {completed ? (
          <span className="uni-badge uni-badge-completed">✓ Completed</span>
        ) : null}

        <button
          type="button"
          onClick={() => doComplete('stay')}
          disabled={!canTrack || pending !== null}
          className="uni-btn uni-btn-secondary uni-focus"
          title={!canTrack ? 'Log in to track your progress' : undefined}
        >
          {pending === 'complete' ? 'Saving…' : completed ? '✓ Completed' : '✓ Mark complete'}
        </button>

        {nextHref ? (
          <button
            type="button"
            onClick={() => doComplete('next')}
            disabled={!canTrack || pending !== null}
            className="uni-btn uni-btn-primary uni-focus"
            title={!canTrack ? 'Log in to track your progress' : undefined}
          >
            {pending === 'next' ? 'Saving…' : 'Mark complete & next'}
            <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <Link href={finishHref} className="uni-btn uni-btn-primary uni-focus" onClick={() => void doComplete('stay')}>
            {completed ? 'Finish course' : 'Mark complete & finish'}
            <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        )}

        {!canTrack ? (
          <span style={{ fontSize: 12.5, color: 'var(--uni-ink-3)' }}>
            <Link href="/login" className="uni-focus" style={{ color: 'var(--uni-accent-ink)', fontWeight: 600 }}>
              Log in
            </Link>{' '}
            to track your progress.
          </span>
        ) : null}
      </div>

      {/* transient toast */}
      {toast ? (
        <div
          role="status"
          style={{
            marginTop: 12,
            fontSize: 13,
            color: 'var(--uni-ink-2)',
            background: 'var(--uni-surface-2)',
            border: '1px solid var(--uni-border)',
            borderRadius: 'var(--uni-r-sm)',
            padding: '8px 12px',
            display: 'inline-block',
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  )
}

export default LessonPlayer
