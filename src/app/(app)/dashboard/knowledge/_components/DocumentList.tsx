'use client'
import Link from 'next/link'
import type {
  CategoryRow,
  DocumentListRow,
  TagRow,
} from '../_lib/queries'
import { PinButton } from './PinButton'
import { EmbeddingStatusBadge } from './EmbeddingStatusBadge'

export function DocumentList({
  documents,
  categories,
  tags,
}: {
  documents: DocumentListRow[]
  categories: CategoryRow[]
  tags: TagRow[]
}) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-10 text-center">
        <p className="text-[14px] font-medium text-[#111827]">No documents yet</p>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Click <span className="font-medium">New document</span> to capture business knowledge.
        </p>
      </div>
    )
  }

  const catById = new Map(categories.map((c) => [c.id, c]))
  const tagById = new Map(tags.map((t) => [t.id, t]))

  // Drop target: when a doc is dragged onto a category pill, the pill calls
  // a server action to move the doc. Here we just register `draggable`.
  return (
    <ul className="divide-y divide-[#F3F4F6] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {documents.map((d) => {
        const cat = d.category_id ? catById.get(d.category_id) : null
        return (
          <li
            key={d.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-knowledge-doc-id', d.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <Link
              href={`/dashboard/knowledge/${d.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#F9FAFB]"
            >
              <PinButton id={d.id} pinned={d.is_pinned} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-[#111827]">
                    {d.title || 'Untitled'}
                  </span>
                  {d.tag_ids.slice(0, 4).map((tid) => {
                    const t = tagById.get(tid)
                    if (!t) return null
                    return (
                      <span
                        key={tid}
                        className="rounded-full bg-[#f1f3f4] px-1.5 py-0.5 text-[10.5px] text-[#5f6368]"
                      >
                        #{t.name}
                      </span>
                    )
                  })}
                  {d.tag_ids.length > 4 && (
                    <span className="text-[10.5px] text-[#9aa0a6]">
                      +{d.tag_ids.length - 4}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[#6B7280]">
                  <span>{d.version === 0 ? 'Draft' : `v${d.version}`}</span>
                  <span className="text-[#D1D5DB]">·</span>
                  <span>Updated {formatRelative(d.updated_at)}</span>
                  {d.has_unsaved_changes && (
                    <>
                      <span className="text-[#D1D5DB]">·</span>
                      <span className="text-amber-600">Unsaved</span>
                    </>
                  )}
                  <EmbeddingStatusBadge
                    status={d.embedding_status}
                    embeddedAt={d.embedded_at}
                    hasUnsavedChanges={d.has_unsaved_changes}
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
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
