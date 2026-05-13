'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { countPendingSuggestions } from '../actions/suggestions'

const KEY = 'leads:suggestions:toast-acked'

export function SuggestionsToast() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(KEY)) return
    countPendingSuggestions().then((n) => {
      if (n > 0) setCount(n)
    })
  }, [])

  if (!count) return null

  const dismiss = () => {
    sessionStorage.setItem(KEY, '1')
    setCount(null)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-white p-4 shadow-lg">
      <div className="text-sm font-medium">
        {count} suggested stage improvement{count === 1 ? '' : 's'} based on your knowledge.
      </div>
      <div className="mt-2 flex gap-2">
        <Link
          href="/dashboard/leads/stages"
          className="rounded bg-blue-700 px-3 py-1 text-xs text-white"
          onClick={dismiss}
        >
          Review
        </Link>
        <button onClick={dismiss} className="rounded border px-3 py-1 text-xs">
          Later
        </button>
      </div>
    </div>
  )
}
