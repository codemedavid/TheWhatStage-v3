'use client'

import { useState, useTransition } from 'react'
import { setPrimaryActionPage } from '../actions'

export interface PrimaryGoalOption {
  id: string
  title: string
  slug: string
}

export function PrimaryGoalSection({
  current,
  options,
}: {
  current: string | null
  options: PrimaryGoalOption[]
}) {
  const [value, setValue] = useState<string>(current ?? '')
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function onChange(next: string) {
    setValue(next)
    setSaved(false)
    startTransition(async () => {
      await setPrimaryActionPage(next === '' ? null : next)
      setSaved(true)
    })
  }

  return (
    <div className="cb-section">
      <div className="cb-section-head">
        <h2>Primary goal</h2>
        <p>
          When set, your chatbot will gently steer open-ended conversations
          toward this page. Campaign-specific goals override this.
        </p>
      </div>
      <div className="cb-section-body">
        <div className="cb-field">
          <label htmlFor="primary-goal">Action page</label>
          <select
            id="primary-goal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={pending}
          >
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          {pending && <span className="cb-muted">Saving…</span>}
          {saved && !pending && <span className="cb-muted">Saved</span>}
        </div>
        {options.length === 0 && (
          <p className="cb-muted">
            Publish an action page first to use it as a primary goal.
          </p>
        )}
      </div>
    </div>
  )
}
