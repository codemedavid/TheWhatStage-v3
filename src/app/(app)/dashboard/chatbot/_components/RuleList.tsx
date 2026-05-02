'use client'

import { useState } from 'react'

type Props = {
  name: string
  initial: string[]
  placeholder?: string
  addLabel?: string
}

let rowCounter = 0
const nextKey = () => `r${++rowCounter}`

export function RuleList({ name, initial, placeholder, addLabel = 'Add rule' }: Props) {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() =>
    (initial.length ? initial : ['']).map((value) => ({ key: nextKey(), value })),
  )

  function update(key: string, value: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, value } : r)))
  }

  function remove(key: string) {
    setRows((rs) => {
      const next = rs.filter((r) => r.key !== key)
      return next.length ? next : [{ key: nextKey(), value: '' }]
    })
  }

  function add() {
    setRows((rs) => [...rs, { key: nextKey(), value: '' }])
  }

  return (
    <div className="cb-rule-items">
      {rows.map((row, i) => (
        <div key={row.key} className="cb-rule-item">
          <span className="cb-rule-num">{i + 1}</span>
          <input
            name={name}
            value={row.value}
            onChange={(e) => update(row.key, e.target.value)}
            placeholder={placeholder}
            className="cb-rule-input"
          />
          <button
            type="button"
            onClick={() => remove(row.key)}
            aria-label={`Remove rule ${i + 1}`}
            className="cb-rule-rm"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="cb-add-rule-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        {addLabel}
      </button>
    </div>
  )
}
