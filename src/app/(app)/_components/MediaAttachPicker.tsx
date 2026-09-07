'use client'

import { useEffect, useState } from 'react'
import { MediaPickerModal, type PickedAsset } from '@/app/(app)/dashboard/chatbot/_components/MediaPickerModal'
import { mediaKindFromMime, mediaKindLabel } from '@/lib/media/kind'

interface KnownAsset {
  id: string
  name: string
  mime_type: string
}

// Compact "attach media" row used by sequence steps and agent campaigns:
// shows the picked library items as chips and opens the shared picker (all
// kinds) to change them.
export function MediaAttachPicker({
  value,
  max,
  onChange,
  label = '+ Attach image, video or voice message',
  disabled = false,
}: {
  value: string[]
  max: number
  onChange: (ids: string[]) => void
  label?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [known, setKnown] = useState<Map<string, KnownAsset>>(new Map())

  const unknownIds = value.filter((id) => !known.has(id))
  const unknownKey = unknownIds.join(',')

  useEffect(() => {
    if (!unknownKey) return
    const ctrl = new AbortController()
    fetch(`/api/media/assets?ids=${encodeURIComponent(unknownKey)}`, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? (r.json() as Promise<{ assets: KnownAsset[] }>) : Promise.reject(new Error(await r.text()))))
      .then((j) => {
        setKnown((prev) => {
          const next = new Map(prev)
          for (const a of j.assets) next.set(a.id, a)
          return next
        })
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') console.warn('[MediaAttachPicker] hydrate failed', e)
      })
    return () => ctrl.abort()
  }, [unknownKey])

  function onPicked(picked: PickedAsset[]) {
    setKnown((prev) => {
      const next = new Map(prev)
      for (const p of picked) next.set(p.id, { id: p.id, name: p.name, mime_type: p.mimeType ?? '' })
      return next
    })
    onChange(picked.map((p) => p.id))
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const a = known.get(id)
        const kind = mediaKindFromMime(a?.mime_type) ?? 'image'
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]"
            style={{ borderColor: 'currentColor', opacity: 0.9 }}
            title={a?.name ?? id}
          >
            <span aria-hidden>{kind === 'audio' ? '🎙' : kind === 'video' ? '▶' : '🖼'}</span>
            <span className="max-w-[160px] truncate">{a?.name ?? mediaKindLabel(kind)}</span>
            <button
              type="button"
              aria-label={`Remove ${a?.name ?? 'attachment'}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
              disabled={disabled}
              className="ml-0.5 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </span>
        )
      })}
      {value.length < max && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="rounded-full border border-dashed px-2.5 py-0.5 text-[11.5px] opacity-80 hover:opacity-100 disabled:opacity-40"
          style={{ borderColor: 'currentColor' }}
        >
          {label}
        </button>
      )}
      <MediaPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={onPicked}
        initialSelectedIds={value}
        maxSelect={max}
      />
    </div>
  )
}
