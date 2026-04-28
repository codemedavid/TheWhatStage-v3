'use client'
import { useUrlState } from './_useUrlState'

export function ViewToggle({ view }: { view: 'kanban' | 'table' }) {
  const { set } = useUrlState()
  return (
    <div className="inline-flex rounded-md border border-[#E5E7EB] overflow-hidden">
      {(['kanban', 'table'] as const).map((v) => (
        <button
          key={v}
          onClick={() => set({ view: v })}
          className={`px-3 py-1.5 text-sm ${view === v ? 'bg-[#059669] text-white' : 'bg-white text-[#374151]'}`}
        >
          {v === 'kanban' ? 'Kanban' : 'Table'}
        </button>
      ))}
    </div>
  )
}
