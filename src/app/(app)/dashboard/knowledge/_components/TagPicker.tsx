'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDocumentTags, createTag } from '../actions/tags'
import type { TagRow } from '../_lib/queries'

// Inline multi-select tag chips for a document. Pop-up with all available
// tags (toggleable) + an inline "create new tag" input.
export function TagPicker({
  docId,
  allTags,
  selectedIds,
}: {
  docId: string
  allTags: TagRow[]
  selectedIds: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const selected = new Set(selectedIds)
  const selectedTags = allTags.filter((t) => selected.has(t.id))

  const apply = (next: Set<string>) =>
    start(async () => {
      try {
        await setDocumentTags({ id: docId, tagIds: Array.from(next) })
        router.refresh()
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }

  const remove = (id: string) => {
    const next = new Set(selected)
    next.delete(id)
    apply(next)
  }

  const addNew = () => {
    const name = draft.trim()
    if (!name) return
    start(async () => {
      try {
        const { id } = await createTag({ name })
        const next = new Set(selected)
        next.add(id)
        await setDocumentTags({ id: docId, tagIds: Array.from(next) })
        setDraft('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="relative flex items-center gap-1">
      {selectedTags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[11.5px] text-[#3c4043]"
        >
          #{t.name}
          <button
            type="button"
            onClick={() => remove(t.id)}
            aria-label={`Remove ${t.name}`}
            className="text-[#9aa0a6] hover:text-[#3c4043]"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center rounded-full border border-dashed border-[#dadce0] px-2 text-[11.5px] text-[#5f6368] hover:bg-[#f1f3f4]"
      >
        + Tag
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-64 overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-md">
            <div className="border-b border-[#e8eaed] p-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Find or create…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addNew()
                  }
                }}
                className="w-full rounded border border-[#e8eaed] px-2 py-1 text-[12.5px] outline-none focus:border-[#059669]"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {allTags
                .filter((t) =>
                  draft.trim()
                    ? t.name.toLowerCase().includes(draft.trim().toLowerCase())
                    : true,
                )
                .map((t) => {
                  const checked = selected.has(t.id)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => toggle(t.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[#3c4043] hover:bg-[#f1f3f4]"
                      >
                        <span
                          className={
                            'inline-block h-3 w-3 rounded-sm border ' +
                            (checked
                              ? 'border-[#059669] bg-[#059669]'
                              : 'border-[#dadce0]')
                          }
                          aria-hidden
                        />
                        <span>#{t.name}</span>
                      </button>
                    </li>
                  )
                })}
              {draft.trim() &&
                !allTags.some(
                  (t) =>
                    t.name.toLowerCase() === draft.trim().toLowerCase(),
                ) && (
                  <li>
                    <button
                      type="button"
                      onClick={addNew}
                      disabled={pending}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[#059669] hover:bg-[#f1f3f4]"
                    >
                      + Create &ldquo;#{draft.trim()}&rdquo;
                    </button>
                  </li>
                )}
            </ul>
            {error && (
              <p className="border-t border-[#e8eaed] px-3 py-1 text-[11.5px] text-red-600">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
