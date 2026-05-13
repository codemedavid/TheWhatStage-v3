'use client'
import { useState, useTransition } from 'react'
import { createStage, updateStage, deleteStage, reorderStages } from '../actions/stages'
import type { StageRow } from '../_lib/queries'
import { SignalChipsInput } from './SignalChipsInput'

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
  const [entrySignals, setEntrySignals] = useState<string[]>(stage.entry_signals)
  const [exitSignals, setExitSignals] = useState<string[]>(stage.exit_signals)
  const [requiredFields, setRequiredFields] = useState<string[]>(stage.required_fields)
  const [, start] = useTransition()

  const save = () =>
    start(async () => {
      await updateStage(stage.id, {
        name,
        description: desc || null,
        entry_signals: entrySignals,
        exit_signals: exitSignals,
        required_fields: requiredFields,
      })
      setEdit(false)
    })

  const cancelEdit = () => {
    setName(stage.name)
    setDesc(stage.description ?? '')
    setEntrySignals(stage.entry_signals)
    setExitSignals(stage.exit_signals)
    setRequiredFields(stage.required_fields)
    setEdit(false)
  }

  return (
    <li className="p-3 flex items-start gap-3">
      <div className="flex flex-col pt-1">
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
        <div className="flex-1 space-y-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Stage name"
              className="border rounded px-2 py-1 text-sm w-40"
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="When should the AI move leads here?"
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
          </div>
          <SignalChipsInput
            label="Entry signals"
            value={entrySignals}
            onChange={setEntrySignals}
            placeholder="Add entry signal and press Enter"
          />
          <SignalChipsInput
            label="Exit signals"
            value={exitSignals}
            onChange={setExitSignals}
            placeholder="Add exit signal and press Enter"
          />
          <SignalChipsInput
            label="Required fields"
            value={requiredFields}
            onChange={setRequiredFields}
            placeholder="Add required field and press Enter"
          />
          <div className="flex gap-2">
            <button onClick={save} className="px-2 py-1 text-sm bg-emerald-600 text-white rounded">
              Save
            </button>
            <button onClick={cancelEdit} className="px-2 py-1 text-sm border rounded">
              Cancel
            </button>
          </div>
        </div>
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
            {stage.entry_signals.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {stage.entry_signals.map((s, i) => (
                  <span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                    {s}
                  </span>
                ))}
              </div>
            )}
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
