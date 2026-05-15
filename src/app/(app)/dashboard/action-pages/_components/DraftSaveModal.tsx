'use client'

import { useEffect } from 'react'

export function DraftSaveModal({
  open,
  onClose,
  onMakeLive,
  onKeepDraft,
}: {
  open: boolean
  onClose: () => void
  onMakeLive: () => void
  onKeepDraft: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-save-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/40 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl ring-1 ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="draft-save-title"
          className="text-[15px] font-semibold text-zinc-900"
        >
          Publish this action page?
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
          This page is still a <b>Draft</b>. Drafts are not visible to leads
          and the bot won&apos;t send them. Make it Live to start using it, or
          keep it as a draft for now.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onKeepDraft}
            className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Keep as Draft
          </button>
          <button
            type="button"
            onClick={onMakeLive}
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Make Live
          </button>
        </div>
      </div>
    </div>
  )
}
