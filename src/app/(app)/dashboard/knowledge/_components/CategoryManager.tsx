'use client'
import { useState, useTransition } from 'react'
import {
  createCategory,
  renameCategory,
  deleteCategory,
} from '../actions/categories'
import type { CategoryRow } from '../_lib/queries'

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-md border border-[#E5E7EB] bg-white px-3 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB]"
      >
        Manage categories
      </button>
      {open && (
        <ManagerDialog categories={categories} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function ManagerDialog({
  categories,
  onClose,
}: {
  categories: CategoryRow[]
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const handleCreate = () => {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    start(async () => {
      try {
        await createCategory({ name: trimmed })
        setName('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#111827]">Categories</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[#6B7280] hover:text-[#111827]"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            className="flex-1 rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px] outline-none focus:border-[#059669]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={pending || !name.trim()}
            className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#047857] disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && (
          <p className="mb-3 text-[12px] text-red-600">{error}</p>
        )}

        <ul className="divide-y divide-[#F3F4F6]">
          {categories.length === 0 ? (
            <li className="py-6 text-center text-[13px] text-[#6B7280]">
              No categories yet.
            </li>
          ) : (
            categories.map((c) => (
              <CategoryRowItem key={c.id} category={c} />
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

function CategoryRowItem({ category }: { category: CategoryRow }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(category.name)
  const [pending, start] = useTransition()

  const save = () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === category.name) {
      setEditing(false)
      return
    }
    start(async () => {
      await renameCategory({ id: category.id, name: trimmed })
      setEditing(false)
    })
  }

  const remove = () => {
    if (!confirm(`Delete category "${category.name}"? Documents will become uncategorized.`)) return
    start(() => deleteCategory({ id: category.id }))
  }

  return (
    <li className="flex items-center gap-2 py-2">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setDraft(category.name)
              setEditing(false)
            }
          }}
          className="flex-1 rounded border border-[#059669] px-2 py-1 text-[13px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 truncate text-left text-[13px] text-[#111827] hover:text-[#059669]"
        >
          {category.name}
        </button>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-[12px] text-[#6B7280] hover:text-red-600"
      >
        Delete
      </button>
    </li>
  )
}
