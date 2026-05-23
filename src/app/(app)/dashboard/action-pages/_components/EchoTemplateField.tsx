'use client'

import { useMemo, useRef, useState } from 'react'
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import { knownPathsForKind, sampleContextForKind, VARIABLES_BY_KIND, type VariableDef } from '@/lib/action-pages/echo/variables'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface EchoTemplateFieldProps {
  name: string
  kind: ActionPageKind
  customKeys: readonly string[]
  defaultValue: string
  rows?: number
  compact?: boolean
  maxLength?: number
  placeholder?: string
  onChange?: (v: string) => void
}

export function EchoTemplateField(props: EchoTemplateFieldProps) {
  const {
    name,
    kind,
    customKeys,
    defaultValue,
    rows = 3,
    compact = false,
    maxLength = 640,
    placeholder,
    onChange,
  } = props

  const [text, setText] = useState(defaultValue)
  const [pickerOpen, setPickerOpen] = useState(!compact)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const groups = useMemo(() => {
    const variables = VARIABLES_BY_KIND[kind]
    const map = new Map<string, VariableDef[]>()
    for (const v of variables) {
      const list = map.get(v.group) ?? []
      list.push(v)
      map.set(v.group, list)
    }
    if (customKeys.length > 0) {
      map.set(
        'Custom',
        customKeys.map((k) => ({
          path: `custom.${k}`,
          label: `Custom: ${k}`,
          sample: `[${k} sample]`,
          group: 'Custom',
        })),
      )
    }
    return Array.from(map.entries())
  }, [kind, customKeys])

  const preview = useMemo(() => {
    const known = knownPathsForKind(kind, customKeys)
    const ctx = sampleContextForKind(kind, customKeys)
    return renderEchoTemplate(text, ctx, known)
  }, [text, kind, customKeys])

  function setTextAndNotify(v: string) {
    setText(v)
    onChange?.(v)
  }

  function insertAtCursor(token: string) {
    const ta = taRef.current
    const start = ta ? ta.selectionStart ?? text.length : text.length
    const end = ta ? ta.selectionEnd ?? text.length : text.length
    const insertion = `{{${token}}}`
    const next = text.slice(0, start) + insertion + text.slice(end)
    setTextAndNotify(next)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const pos = start + insertion.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const picker = (
    <div className={compact ? 'rounded border border-[#E5E7EB] bg-[#FAFAFA] p-2 text-[12px]' : 'rounded border border-[#E5E7EB] bg-[#FAFAFA] p-3 text-[12px]'}>
      <div className="mb-2 font-semibold text-[#111827]">Variables</div>
      {groups.map(([group, items]) => (
        <div key={group} className="mb-2">
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            {group}
          </div>
          {items.map((v) => (
            <button
              key={v.path}
              type="button"
              aria-label={v.label}
              onClick={() => insertAtCursor(v.path)}
              className="block w-full rounded px-1 py-0.5 text-left hover:bg-white"
            >
              <code>{`{{${v.path}}}`}</code>
            </button>
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div className={compact ? 'space-y-2' : 'grid gap-4 md:grid-cols-[1fr_220px]'}>
      <div>
        <textarea
          ref={taRef}
          name={name}
          value={text}
          onChange={(e) => setTextAndNotify(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          className="ap-textarea w-full"
        />
        <div data-testid="echo-preview" className="mt-3 text-[13px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Preview (sample data)
          </div>
          <div className="inline-block max-w-full rounded-2xl bg-[#F0F2F5] px-3 py-2 text-[#050505] whitespace-pre-wrap">
            {preview.text || <span className="text-[#9CA3AF]">Empty</span>}
          </div>
        </div>
        {preview.warnings.length > 0 && (
          <div
            data-testid="echo-warnings"
            className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
          >
            <div className="font-semibold">Unknown or malformed tokens:</div>
            <ul className="mt-1 list-disc pl-5">
              {preview.warnings.map((w, i) => (
                <li key={i}>
                  <code>{w.token || '(empty)'}</code> — {w.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {compact && !pickerOpen && (
        <div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            Insert variable
          </button>
        </div>
      )}
      {(!compact || pickerOpen) && picker}
    </div>
  )
}
