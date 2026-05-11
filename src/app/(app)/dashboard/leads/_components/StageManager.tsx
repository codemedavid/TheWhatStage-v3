'use client'
import { useState, useTransition } from 'react'
import { createStage, updateStage, deleteStage, reorderStages } from '../actions/stages'
import type { StageRow } from '../_lib/queries'

export function StageManager({ stages }: { stages: StageRow[] }) {
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    start(async () => {
      await createStage({ name, description: desc || null })
      setName('')
      setDesc('')
    })
  }

  const move = (idx: number, dir: -1 | 1) => {
    const newOrder = stages.map((s) => s.id)
    const j = idx + dir
    if (j < 0 || j >= newOrder.length) return
    ;[newOrder[idx], newOrder[j]] = [newOrder[j], newOrder[idx]]
    start(async () => {
      await reorderStages(newOrder)
    })
  }

  const remove = (s: StageRow) => {
    if (s.is_default) {
      alert('Cannot delete the default stage.')
      return
    }
    if (!confirm(`Delete "${s.name}"? Its leads will move to the default stage.`)) return
    start(async () => {
      await deleteStage(s.id)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex items-end gap-2 border p-3 rounded-md">
        <label className="flex-1">
          <div className="text-xs">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex-1">
          <div className="text-xs font-medium">When should the AI move leads here?</div>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. Lead has confirmed interest and asked about pricing or availability"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div className="text-[11px] text-[#9CA3AF] mt-0.5">
            Describe the signals — keywords, intent, replies. The AI uses this to auto-classify conversations into this stage.
          </div>
        </label>
        <button
          disabled={pending}
          className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md"
        >
          Add stage
        </button>
      </form>

      <ul className="border rounded-md divide-y">
        {stages.map((s, i) => (
          <StageRowItem
            key={s.id}
            stage={s}
            index={i}
            count={stages.length}
            onMove={move}
            onDelete={remove}
            pending={pending}
          />
        ))}
      </ul>
    </div>
  )
}

function StageRowItem({
  stage, index, count, onMove, onDelete, pending,
}: {
  stage: StageRow
  index: number
  count: number
  onMove: (i: number, d: -1 | 1) => void
  onDelete: (s: StageRow) => void
  pending: boolean
}) {
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(stage.name)
  const [desc, setDesc] = useState(stage.description ?? '')
  const [, start] = useTransition()

  const save = () =>
    start(async () => {
      await updateStage(stage.id, { name, description: desc || null })
      setEdit(false)
    })

  return (
    <li className="p-3 flex items-center gap-3">
      <div className="flex flex-col">
        <button
          disabled={index === 0 || pending}
          onClick={() => onMove(index, -1)}
          className="text-xs disabled:opacity-30"
        >
          ▲
        </button>
        <button
          disabled={index === count - 1 || pending}
          onClick={() => onMove(index, 1)}
          className="text-xs disabled:opacity-30"
        >
          ▼
        </button>
      </div>
      {edit ? (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button onClick={save} className="px-2 py-1 text-sm bg-emerald-600 text-white rounded">
            Save
          </button>
          <button onClick={() => setEdit(false)} className="px-2 py-1 text-sm border rounded">
            Cancel
          </button>
        </>
      ) : (
        <>
          <div className="flex-1">
            <div className="text-sm font-medium">
              {stage.name}{' '}
              {stage.is_default && (
                <span className="text-xs text-emerald-700">(default)</span>
              )}
            </div>
            <div className="text-xs text-[#6B7280]">{stage.description}</div>
          </div>
          <button
            onClick={() => setEdit(true)}
            className="px-2 py-1 text-sm border rounded"
          >
            Edit
          </button>
          <button
            disabled={stage.is_default}
            onClick={() => onDelete(stage)}
            className="px-2 py-1 text-sm border border-red-300 text-red-700 rounded disabled:opacity-50"
          >
            Delete
          </button>
        </>
      )}
    </li>
  )
}
