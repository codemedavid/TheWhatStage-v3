'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function ProductImageUpload({
  productId,
  currentUrl,
}: {
  productId: string
  currentUrl: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleFile(file: File) {
    setError(null)
    const fd = new FormData()
    fd.append('productId', productId)
    fd.append('file', file)

    const res = await fetch('/api/imagekit/upload', { method: 'POST', body: fd })
    const json = (await res.json()) as { url?: string; error?: string }
    if (!res.ok || !json.url) {
      setError(json.error ?? 'Upload failed')
      return
    }
    setPreview(json.url)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt="Product cover"
            className="aspect-[4/3] w-full rounded-md object-cover"
          />
          <button
            type="button"
            onClick={() => {
              setPreview(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
            className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-black/70"
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
          className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#D1D5DB] bg-[#F9FAFB] text-[13px] text-[#6B7280] hover:border-[#059669] hover:bg-[#F0FDF4]"
        >
          <span className="text-2xl">🖼</span>
          <span>Click to upload cover image</span>
          <span className="text-[11px] text-[#9CA3AF]">JPEG, PNG or WebP · max 5 MB</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {isPending && (
        <p className="text-[12px] text-[#6B7280]">Uploading…</p>
      )}
      {error && (
        <p className="text-[12px] text-[#DC2626]">{error}</p>
      )}

      {!preview && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
        >
          Upload image
        </button>
      )}
    </div>
  )
}
