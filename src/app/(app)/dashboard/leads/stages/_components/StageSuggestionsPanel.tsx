'use client'
import { useEffect, useState, useTransition } from 'react'
import { listPendingSuggestions, acceptSuggestion, rejectSuggestion } from '../../actions/suggestions'

type RawSuggestion = Awaited<ReturnType<typeof listPendingSuggestions>>[number]
type SuggestionRow = Omit<RawSuggestion, 'pipeline_stages'> & {
  pipeline_stages: { name: string } | { name: string }[] | null
}

function getStageName(s: SuggestionRow): string {
  if (!s.pipeline_stages) return s.stage_id
  if (Array.isArray(s.pipeline_stages)) return s.pipeline_stages[0]?.name ?? s.stage_id
  return s.pipeline_stages.name
}

export function StageSuggestionsPanel() {
  const [items, setItems] = useState<SuggestionRow[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    listPendingSuggestions().then((data) => setItems(data as unknown as SuggestionRow[]))
  }, [])

  if (!items || items.length === 0) return null

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="font-medium text-blue-900">
        {items.length} suggested improvement{items.length === 1 ? '' : 's'} from your knowledge base
      </div>
      <ul className="mt-3 space-y-3">
        {items.map((s) => (
          <li key={s.id} className="rounded border bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                {getStageName(s)} — <code>{s.field}</code>
              </div>
              <div className="text-xs text-gray-500">{new Date(s.created_at).toLocaleString()}</div>
            </div>
            <div className="mt-1 text-sm text-gray-700">{s.reason}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="font-semibold text-gray-500">Current</div>
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s.current_value, null, 2)}</pre>
              </div>
              <div>
                <div className="font-semibold text-gray-500">Proposed</div>
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s.proposed_value, null, 2)}</pre>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded bg-blue-700 px-3 py-1 text-sm text-white disabled:opacity-60"
                disabled={isPending}
                onClick={() =>
                  startTransition(() =>
                    acceptSuggestion(s.id).then(() =>
                      setItems((x) => (x ?? []).filter((y) => y.id !== s.id))
                    )
                  )
                }
              >
                Accept
              </button>
              <button
                className="rounded border px-3 py-1 text-sm disabled:opacity-60"
                disabled={isPending}
                onClick={() =>
                  startTransition(() =>
                    rejectSuggestion(s.id).then(() =>
                      setItems((x) => (x ?? []).filter((y) => y.id !== s.id))
                    )
                  )
                }
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
