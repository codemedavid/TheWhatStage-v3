'use client'
import { useState } from 'react'

export function SignalChipsInput({
  label,
  value,
  onChange,
  placeholder = 'Add signal and press Enter',
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (value.includes(v)) { setDraft(''); return }
    onChange([...value, v])
    setDraft('')
  }

  return (
    <div>
      <div className="text-xs font-medium text-gray-600">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1 rounded border p-2">
        {value.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
            {v}
            <button
              type="button"
              className="text-gray-500 hover:text-red-600"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
            if (e.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] text-xs outline-none"
        />
      </div>
    </div>
  )
}
