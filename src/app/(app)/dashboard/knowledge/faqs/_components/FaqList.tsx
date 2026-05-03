'use client'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CategoryRow, FaqRow } from '../../_lib/queries'
import { deleteFaq, reindexFaq, toggleFaqPublished } from '../../actions/faqs'
import { EmbeddingStatusBadge } from '../../_components/EmbeddingStatusBadge'

export function FaqList({
  faqs,
  categories,
}: {
  faqs: FaqRow[]
  categories: CategoryRow[]
}) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const catById = new Map(categories.map((c) => [c.id, c]))

  if (faqs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-12 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(5,150,105,0.08)] text-[#059669]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.09 9a3 3 0 1 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
        <p className="text-[14px] font-medium text-[#111827]">No FAQs yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#6B7280]">
          Capture common questions about your business so your AI assistant can answer them instantly.
        </p>
        <Link
          href="/dashboard/knowledge/faqs/new"
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-[#059669] px-3.5 text-[13px] font-medium text-white hover:bg-[#047857]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add your first FAQ
        </Link>
      </div>
    )
  }

  const onToggle = (f: FaqRow) => {
    setPendingId(f.id)
    startTransition(async () => {
      try {
        await toggleFaqPublished({ id: f.id, isPublished: !f.is_published })
        router.refresh()
      } finally {
        setPendingId(null)
      }
    })
  }

  const onReindex = (f: FaqRow) => {
    setPendingId(f.id)
    startTransition(async () => {
      try {
        await reindexFaq({ id: f.id })
        router.refresh()
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Reindex failed')
      } finally {
        setPendingId(null)
      }
    })
  }

  const onDelete = (f: FaqRow) => {
    if (!confirm(`Delete "${f.question}"? This cannot be undone.`)) return
    setPendingId(f.id)
    startTransition(async () => {
      try {
        await deleteFaq({ id: f.id })
        router.refresh()
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <ul className="divide-y divide-[#F3F4F6] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {faqs.map((f) => {
        const open = openId === f.id
        const cat = f.category_id ? catById.get(f.category_id) : null
        const isPending = pendingId === f.id
        return (
          <li key={f.id} className={isPending ? 'opacity-60' : ''}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : f.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F9FAFB]"
              aria-expanded={open}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={
                  'shrink-0 text-[#9CA3AF] transition-transform ' +
                  (open ? 'rotate-90' : '')
                }
                aria-hidden
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-[#111827]">
                    {f.question}
                  </span>
                  {!f.is_published && (
                    <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10.5px] font-medium text-[#6B7280]">
                      Draft
                    </span>
                  )}
                  <EmbeddingStatusBadge
                    status={f.embedding_status}
                    embeddedAt={f.embedded_at}
                  />
                </div>
              </div>
              {cat ? (
                <span className="rounded-full bg-[rgba(5,150,105,0.08)] px-2.5 py-0.5 text-[11.5px] font-medium text-[#059669]">
                  {cat.name}
                </span>
              ) : (
                <span className="rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-[11.5px] text-[#6B7280]">
                  Uncategorized
                </span>
              )}
            </button>

            {open && (
              <div className="border-t border-[#F3F4F6] bg-[#FAFAFA] px-4 py-3 pl-[2.1rem]">
                {f.answer ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#374151]">
                    {f.answer}
                  </p>
                ) : (
                  <p className="text-[13px] italic text-[#9CA3AF]">
                    No answer yet.
                  </p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Link
                    href={`/dashboard/knowledge/faqs/${f.id}`}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB]"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => onToggle(f)}
                    disabled={isPending}
                    className="inline-flex h-7 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
                  >
                    {f.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onReindex(f)}
                    disabled={isPending}
                    className="inline-flex h-7 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
                    title="Re-run embedding for this FAQ"
                  >
                    Reindex
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(f)}
                    disabled={isPending}
                    className="ml-auto inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
