'use client'

import { useState } from 'react'

/**
 * Controlled `bot_send_instructions` textarea that shows a small "Default
 * trigger — edit to customize" pill while the value still matches the kind's
 * canned default. As soon as the operator edits a single character, the pill
 * disappears and stays gone.
 */
export function TriggerField({
  initial,
  defaultText,
  className,
  rows = 4,
  placeholder,
}: {
  initial: string
  defaultText: string
  className?: string
  rows?: number
  placeholder?: string
}) {
  const [value, setValue] = useState(initial)
  const isDefault = value === defaultText

  return (
    <div>
      {isDefault && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Default trigger — edit to customize
        </div>
      )}
      <textarea
        name="bot_send_instructions"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 2000))}
        rows={rows}
        maxLength={2000}
        placeholder={placeholder}
        className={className}
      />
    </div>
  )
}
