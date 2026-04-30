'use client'

import { useState } from 'react'
import type { KindEditorProps } from '../types'
import {
  FIELD_KEY_RE,
  FIELD_KINDS,
  parseFormConfig,
  type FieldBlock,
  type FieldKind,
  type FormBlock,
  type FormConfig,
  type HeadingBlock,
  type DescriptionBlock,
} from '@/app/a/[slug]/_kinds/form/schema'

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  if (!base) return 'field'
  if (!/^[a-z]/.test(base)) return `f_${base}`.slice(0, 40)
  return base
}

export default function FormEditor({ page }: KindEditorProps) {
  const [config, setConfig] = useState<FormConfig>(() => {
    const parsed = parseFormConfig(page.config)
    return parsed
  })

  const update = (patch: Partial<FormConfig>) =>
    setConfig((c) => ({ ...c, ...patch }))

  const updateTheme = (patch: Partial<FormConfig['theme']>) =>
    setConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }))

  const setBlocks = (next: FormBlock[]) =>
    setConfig((c) => ({ ...c, blocks: next }))

  const addBlock = (type: FormBlock['type']) => {
    let block: FormBlock
    if (type === 'heading') {
      const h: HeadingBlock = {
        id: uuid(),
        type: 'heading',
        text: 'Section heading',
        level: 2,
      }
      block = h
    } else if (type === 'description') {
      const d: DescriptionBlock = {
        id: uuid(),
        type: 'description',
        text: 'Add helper text or context for the form below.',
      }
      block = d
    } else {
      const idx = config.blocks.filter((b) => b.type === 'field').length + 1
      const f: FieldBlock = {
        id: uuid(),
        type: 'field',
        key: `field_${idx}`,
        label: `Question ${idx}`,
        field_kind: 'short_text',
        required: false,
      }
      block = f
    }
    setBlocks([...config.blocks, block])
  }

  const removeBlock = (id: string) =>
    setBlocks(config.blocks.filter((b) => b.id !== id))

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = config.blocks.findIndex((b) => b.id === id)
    if (idx < 0) return
    const next = [...config.blocks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setBlocks(next)
  }

  const patchBlock = (id: string, patch: Partial<FormBlock>) => {
    setBlocks(
      config.blocks.map((b) =>
        b.id === id ? ({ ...b, ...patch } as FormBlock) : b,
      ),
    )
  }

  return (
    <div className="space-y-5">
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#374151]">
          Theme
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ColorField
            label="Background"
            value={config.theme.background_color}
            onChange={(v) => updateTheme({ background_color: v })}
          />
          <ColorField
            label="Accent (button)"
            value={config.theme.accent_color}
            onChange={(v) => updateTheme({ accent_color: v })}
          />
          <ColorField
            label="Button text"
            value={config.theme.button_text_color}
            onChange={(v) => updateTheme({ button_text_color: v })}
          />
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#374151]">
          Branding
        </h3>
        <div className="mt-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
              Logo URL (optional)
            </span>
            <input
              type="url"
              value={config.branding.logo_url ?? ''}
              onChange={(e) =>
                update({
                  branding: {
                    ...config.branding,
                    logo_url: e.target.value || undefined,
                  },
                })
              }
              placeholder="https://example.com/logo.png"
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            />
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#374151]">
            Blocks
          </h3>
          <span className="text-[12px] text-[#6B7280]">
            {config.blocks.length} block{config.blocks.length === 1 ? '' : 's'}
          </span>
        </div>

        <ul className="mt-2 space-y-2">
          {config.blocks.length === 0 && (
            <li className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 text-center text-[12px] text-[#6B7280]">
              No blocks yet. Add a heading, description, or field below.
            </li>
          )}
          {config.blocks.map((b, i) => (
            <li
              key={b.id}
              className="rounded-md border border-[#E5E7EB] bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  {b.type}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveBlock(b.id, -1)}
                    disabled={i === 0}
                    className="rounded border border-[#E5E7EB] px-2 py-1 text-[11px] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(b.id, 1)}
                    disabled={i === config.blocks.length - 1}
                    className="rounded border border-[#E5E7EB] px-2 py-1 text-[11px] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(b.id)}
                    className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {b.type === 'heading' && (
                <HeadingEditor
                  block={b}
                  onChange={(patch) => patchBlock(b.id, patch)}
                />
              )}
              {b.type === 'description' && (
                <DescriptionEditor
                  block={b}
                  onChange={(patch) => patchBlock(b.id, patch)}
                />
              )}
              {b.type === 'field' && (
                <FieldEditor
                  block={b}
                  onChange={(patch) => patchBlock(b.id, patch)}
                />
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addBlock('heading')}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Heading
          </button>
          <button
            type="button"
            onClick={() => addBlock('description')}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Description
          </button>
          <button
            type="button"
            onClick={() => addBlock('field')}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Field
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#374151]">
          Submit & confirmation
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
              Submit button label
            </span>
            <input
              type="text"
              value={config.submit_button_label}
              onChange={(e) => update({ submit_button_label: e.target.value })}
              maxLength={60}
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
              Success message
            </span>
            <input
              type="text"
              value={config.success_message}
              onChange={(e) => update({ success_message: e.target.value })}
              maxLength={400}
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-[#D1D5DB] bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 font-mono text-[12px]"
        />
      </div>
    </label>
  )
}

function HeadingEditor({
  block,
  onChange,
}: {
  block: HeadingBlock
  onChange: (patch: Partial<HeadingBlock>) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
      <input
        type="text"
        value={block.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Heading text"
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
      />
      <select
        value={block.level}
        onChange={(e) =>
          onChange({ level: Number(e.target.value) as 1 | 2 | 3 })
        }
        className="rounded-md border border-[#D1D5DB] bg-white px-2 py-2 text-[13px]"
      >
        <option value={1}>H1</option>
        <option value={2}>H2</option>
        <option value={3}>H3</option>
      </select>
    </div>
  )
}

function DescriptionEditor({
  block,
  onChange,
}: {
  block: DescriptionBlock
  onChange: (patch: Partial<DescriptionBlock>) => void
}) {
  return (
    <textarea
      value={block.text}
      onChange={(e) => onChange({ text: e.target.value })}
      rows={2}
      placeholder="Description / helper text"
      className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
    />
  )
}

function FieldEditor({
  block,
  onChange,
}: {
  block: FieldBlock
  onChange: (patch: Partial<FieldBlock>) => void
}) {
  const [keyTouched, setKeyTouched] = useState<boolean>(true)
  // If key matches slugify of label, treat as untouched (auto-sync).
  const keyDirty = keyTouched && block.key !== slugifyKey(block.label)

  const onLabelChange = (label: string) => {
    if (!keyDirty) {
      onChange({ label, key: slugifyKey(label) })
    } else {
      onChange({ label })
    }
  }

  const needsOptions =
    block.field_kind === 'select' || block.field_kind === 'radio'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#374151]">
            Label
          </span>
          <input
            type="text"
            value={block.label}
            onChange={(e) => onLabelChange(e.target.value)}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#374151]">
            Key
          </span>
          <input
            type="text"
            value={block.key}
            onChange={(e) => {
              setKeyTouched(true)
              onChange({ key: e.target.value })
            }}
            pattern={FIELD_KEY_RE.source}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 font-mono text-[12px]"
          />
          {!FIELD_KEY_RE.test(block.key) && (
            <span className="mt-1 block text-[11px] text-red-600">
              Lowercase letters, digits, underscores. Must start with a letter.
            </span>
          )}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#374151]">
            Field kind
          </span>
          <select
            value={block.field_kind}
            onChange={(e) =>
              onChange({ field_kind: e.target.value as FieldKind })
            }
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px]"
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#374151]">
            Placeholder
          </span>
          <input
            type="text"
            value={block.placeholder ?? ''}
            onChange={(e) =>
              onChange({ placeholder: e.target.value || undefined })
            }
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            checked={block.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="h-4 w-4"
          />
          <span className="text-[12px] font-semibold text-[#374151]">
            Required
          </span>
        </label>
      </div>

      {needsOptions && (
        <OptionsEditor
          options={block.options ?? []}
          onChange={(options) => onChange({ options })}
        />
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: { label: string; value: string }[]
  onChange: (next: { label: string; value: string }[]) => void
}) {
  const update = (i: number, patch: Partial<{ label: string; value: string }>) => {
    const next = options.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
    onChange(next)
  }
  const remove = (i: number) =>
    onChange(options.filter((_, idx) => idx !== i))
  const add = () =>
    onChange([
      ...options,
      { label: `Option ${options.length + 1}`, value: `option_${options.length + 1}` },
    ])

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        Options
      </div>
      {options.length === 0 && (
        <div className="text-[12px] text-[#6B7280]">No options yet.</div>
      )}
      <ul className="space-y-1">
        {options.map((o, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="text"
              value={o.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label"
              className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[12px]"
            />
            <input
              type="text"
              value={o.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="value"
              className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        className="mt-2 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-white"
      >
        + Add option
      </button>
    </div>
  )
}
