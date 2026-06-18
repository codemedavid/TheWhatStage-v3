'use client'
import { useEffect, useRef, useState } from 'react'
import { trimAudioFile } from '../_lib/audio-trim'

type Props = {
  file: File
  busy: boolean
  onConfirm: (trimmed: File) => void
  onCancel: () => void
  onError: (message: string) => void
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Lets the operator preview an uploaded audio clip and pick a [start, end]
 * window to send. On confirm, the selection is re-encoded to a trimmed WAV via
 * `trimAudioFile` and handed back to the upload flow.
 */
export function AudioTrimmer({ file, busy, onConfirm, onCancel, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrl = useRef<string>('')
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [trimming, setTrimming] = useState(false)

  // One object URL per file; revoked on unmount / file change.
  useEffect(() => {
    const url = URL.createObjectURL(file)
    objectUrl.current = url
    if (audioRef.current) audioRef.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleLoaded = () => {
    const d = audioRef.current?.duration ?? 0
    if (Number.isFinite(d) && d > 0) {
      setDuration(d)
      setStart(0)
      setEnd(d)
    }
  }

  // Keep playback inside the selected window.
  const handleTimeUpdate = () => {
    const el = audioRef.current
    if (!el) return
    if (el.currentTime < start) el.currentTime = start
    if (el.currentTime >= end) el.pause()
  }

  const previewSelection = () => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = start
    void el.play()
  }

  const handleConfirm = async () => {
    if (end - start <= 0) {
      onError('Selected range is empty')
      return
    }
    // Whole clip selected → send the original file untouched (no re-encode).
    if (start <= 0 && end >= duration) {
      onConfirm(file)
      return
    }
    setTrimming(true)
    try {
      const trimmed = await trimAudioFile(file, start, end)
      onConfirm(trimmed)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not trim audio')
    } finally {
      setTrimming(false)
    }
  }

  const disabled = busy || trimming
  const step = duration > 0 ? Math.max(0.1, duration / 1000) : 0.1

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        onLoadedMetadata={handleLoaded}
        onTimeUpdate={handleTimeUpdate}
        controls
        className="w-full"
      />

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
          <span>Start: {formatTime(start)}</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={step}
            value={start}
            disabled={disabled || duration === 0}
            onChange={(e) => setStart(Math.min(Number(e.target.value), end))}
            className="lead-focus w-full"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
          <span>End: {formatTime(end)}</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={step}
            value={end}
            disabled={disabled || duration === 0}
            onChange={(e) => setEnd(Math.max(Number(e.target.value), start))}
            className="lead-focus w-full"
          />
        </label>
        <p className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
          Sending {formatTime(Math.max(0, end - start))} of {formatTime(duration)}.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || duration === 0}
          onClick={previewSelection}
          className="lead-focus rounded-full px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
          style={{ background: 'var(--lead-surface-2)', color: 'var(--lead-body)' }}
        >
          ▶ Preview
        </button>
        <button
          type="button"
          disabled={disabled || duration === 0}
          onClick={() => void handleConfirm()}
          className="lead-focus rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          {trimming ? 'Trimming…' : busy ? 'Sending…' : 'Trim & send'}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="lead-focus ml-auto text-[12px] disabled:opacity-50"
          style={{ color: 'var(--lead-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
