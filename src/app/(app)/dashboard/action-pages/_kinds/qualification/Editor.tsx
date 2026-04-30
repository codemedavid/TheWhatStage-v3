'use client'

import { useMemo, useState } from 'react'
import {
  DEFAULT_QUALIFICATION_CONFIG,
  parseQualificationConfig,
  type QualificationConfig,
  type QualificationQuestion,
  type QuestionKind,
} from '@/app/a/[slug]/_kinds/qualification/schema'
import type { KindEditorProps } from '../types'

function newQuestion(kind: QuestionKind = 'single_choice'): QualificationQuestion {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `q_${Math.random().toString(36).slice(2, 10)}`
  const base: QualificationQuestion = {
    id,
    prompt: '',
    kind,
    required: false,
    weight: 1,
  }
  if (kind === 'single_choice' || kind === 'multi_choice') {
    base.options = [
      { label: 'Option 1', value: 'option_1', score: 1 },
      { label: 'Option 2', value: 'option_2', score: 0 },
    ]
  }
  if (kind === 'rating') {
    base.rating_max = 5
  }
  return base
}

export default function QualificationEditor({ page }: KindEditorProps) {
  const initial = useMemo<QualificationConfig>(
    () => parseQualificationConfig(page.config ?? {}),
    [page.config],
  )
  const [config, setConfig] = useState<QualificationConfig>(initial)

  const update = (partial: Partial<QualificationConfig>) =>
    setConfig((c) => ({ ...c, ...partial }))

  const updateTheme = (partial: Partial<QualificationConfig['theme']>) =>
    setConfig((c) => ({ ...c, theme: { ...c.theme, ...partial } }))

  const updateScoring = (partial: Partial<QualificationConfig['scoring']>) =>
    setConfig((c) => ({ ...c, scoring: { ...c.scoring, ...partial } }))

  const updateIntro = (partial: { headline?: string; body?: string }) =>
    setConfig((c) => ({ ...c, intro: { ...(c.intro ?? {}), ...partial } }))

  const updateOutro = (partial: {
    qualified_message?: string
    disqualified_message?: string
    pending_message?: string
  }) => setConfig((c) => ({ ...c, outro: { ...(c.outro ?? {}), ...partial } }))

  const setQuestion = (idx: number, patch: Partial<QualificationQuestion>) =>
    setConfig((c) => {
      const next = [...c.questions]
      next[idx] = { ...next[idx], ...patch }
      return { ...c, questions: next }
    })

  const removeQuestion = (idx: number) =>
    setConfig((c) => ({ ...c, questions: c.questions.filter((_, i) => i !== idx) }))

  const moveQuestion = (idx: number, dir: -1 | 1) =>
    setConfig((c) => {
      const next = [...c.questions]
      const target = idx + dir
      if (target < 0 || target >= next.length) return c
      const [it] = next.splice(idx, 1)
      next.splice(target, 0, it)
      return { ...c, questions: next }
    })

  const addQuestion = () =>
    setConfig((c) => ({ ...c, questions: [...c.questions, newQuestion()] }))

  const changeKind = (idx: number, kind: QuestionKind) => {
    setConfig((c) => {
      const next = [...c.questions]
      const cur = next[idx]
      const replaced: QualificationQuestion = {
        ...cur,
        kind,
        options:
          kind === 'single_choice' || kind === 'multi_choice'
            ? (cur.options ?? [
                { label: 'Option 1', value: 'option_1', score: 1 },
                { label: 'Option 2', value: 'option_2', score: 0 },
              ])
            : undefined,
        rating_max: kind === 'rating' ? (cur.rating_max ?? 5) : undefined,
        min_rating_to_pass: kind === 'rating' ? cur.min_rating_to_pass : undefined,
      }
      next[idx] = replaced
      return { ...c, questions: next }
    })
  }

  return (
    <div className="space-y-6">
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      {/* Theme */}
      <Subsection title="Theme">
        <div className="grid grid-cols-3 gap-3">
          <ColorField
            label="Background"
            value={config.theme.background_color}
            onChange={(v) => updateTheme({ background_color: v })}
          />
          <ColorField
            label="Accent"
            value={config.theme.accent_color}
            onChange={(v) => updateTheme({ accent_color: v })}
          />
          <ColorField
            label="Button text"
            value={config.theme.button_text_color}
            onChange={(v) => updateTheme({ button_text_color: v })}
          />
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={config.progress_bar}
            onChange={(e) => update({ progress_bar: e.target.checked })}
          />
          Show progress bar
        </label>
      </Subsection>

      {/* Intro */}
      <Subsection title="Intro">
        <Field label="Headline">
          <input
            type="text"
            value={config.intro?.headline ?? ''}
            onChange={(e) => updateIntro({ headline: e.target.value })}
            maxLength={200}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            placeholder="Tell us a bit about you"
          />
        </Field>
        <Field label="Body">
          <textarea
            value={config.intro?.body ?? ''}
            onChange={(e) => updateIntro({ body: e.target.value })}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            placeholder="A short paragraph shown above the first question."
          />
        </Field>
      </Subsection>

      {/* Questions */}
      <Subsection
        title="Questions"
        right={
          <button
            type="button"
            onClick={addQuestion}
            className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Add question
          </button>
        }
      >
        {config.questions.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-6 text-center text-[13px] text-[#6B7280]">
            No questions yet. Click “+ Add question” to start.
          </div>
        ) : (
          <ol className="space-y-3">
            {config.questions.map((q, idx) => (
              <li
                key={q.id}
                className="rounded-md border border-[#E5E7EB] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#6B7280]">
                    Q{idx + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <IconBtn
                      label="Move up"
                      disabled={idx === 0}
                      onClick={() => moveQuestion(idx, -1)}
                    >
                      ↑
                    </IconBtn>
                    <IconBtn
                      label="Move down"
                      disabled={idx === config.questions.length - 1}
                      onClick={() => moveQuestion(idx, 1)}
                    >
                      ↓
                    </IconBtn>
                    <IconBtn label="Remove" onClick={() => removeQuestion(idx)}>
                      ✕
                    </IconBtn>
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  <Field label="Prompt">
                    <input
                      type="text"
                      value={q.prompt}
                      onChange={(e) => setQuestion(idx, { prompt: e.target.value })}
                      maxLength={500}
                      className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
                      placeholder="What's your monthly budget?"
                    />
                  </Field>

                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Type">
                      <select
                        value={q.kind}
                        onChange={(e) => changeKind(idx, e.target.value as QuestionKind)}
                        className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-2 text-[13px]"
                      >
                        <option value="single_choice">Single choice</option>
                        <option value="multi_choice">Multi choice</option>
                        <option value="short_text">Short text</option>
                        <option value="rating">Rating</option>
                      </select>
                    </Field>
                    <Field label="Weight">
                      <input
                        type="number"
                        value={q.weight}
                        step="any"
                        onChange={(e) =>
                          setQuestion(idx, { weight: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
                      />
                    </Field>
                    <Field label="Required">
                      <label className="flex h-[38px] items-center gap-2 text-[13px] text-[#374151]">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) =>
                            setQuestion(idx, { required: e.target.checked })
                          }
                        />
                        Required
                      </label>
                    </Field>
                  </div>

                  {(q.kind === 'single_choice' || q.kind === 'multi_choice') && (
                    <OptionsEditor
                      options={q.options ?? []}
                      onChange={(opts) => setQuestion(idx, { options: opts })}
                    />
                  )}

                  {q.kind === 'rating' && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Max value">
                        <input
                          type="number"
                          min={3}
                          max={10}
                          value={q.rating_max ?? 5}
                          onChange={(e) =>
                            setQuestion(idx, {
                              rating_max: Math.max(3, Math.min(10, Number(e.target.value) || 5)),
                            })
                          }
                          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
                        />
                      </Field>
                      <Field label="Pass at (optional)">
                        <input
                          type="number"
                          value={q.min_rating_to_pass ?? ''}
                          onChange={(e) => {
                            const v = e.target.value
                            setQuestion(idx, {
                              min_rating_to_pass: v === '' ? undefined : Number(v),
                            })
                          }}
                          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Subsection>

      {/* Scoring */}
      <Subsection title="Scoring">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">
            <select
              value={config.scoring.mode}
              onChange={(e) =>
                updateScoring({
                  mode: e.target.value as QualificationConfig['scoring']['mode'],
                })
              }
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
            >
              <option value="rule_based">Rule-based</option>
              <option value="manual_review">Manual review</option>
            </select>
          </Field>
          {config.scoring.mode === 'rule_based' && (
            <Field label="Threshold">
              <input
                type="number"
                value={config.scoring.threshold ?? 0}
                step="any"
                onChange={(e) =>
                  updateScoring({ threshold: Number(e.target.value) || 0 })
                }
                className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
              />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qualified outcome">
            <input
              type="text"
              value={config.scoring.qualified_outcome ?? 'qualified'}
              onChange={(e) => updateScoring({ qualified_outcome: e.target.value })}
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
            />
          </Field>
          <Field label="Disqualified outcome">
            <input
              type="text"
              value={config.scoring.disqualified_outcome ?? 'disqualified'}
              onChange={(e) =>
                updateScoring({ disqualified_outcome: e.target.value })
              }
              className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
            />
          </Field>
        </div>
        <p className="text-[12px] text-[#6B7280]">
          The matching outcome triggers the pipeline rule above.{' '}
          {config.scoring.mode === 'manual_review'
            ? 'Manual-review mode always emits “pending_review”.'
            : 'Rule-based mode compares the summed weighted score to the threshold.'}
        </p>
      </Subsection>

      {/* Outro */}
      <Subsection title="Outro messages">
        <Field label="Qualified message">
          <textarea
            value={config.outro?.qualified_message ?? ''}
            onChange={(e) => updateOutro({ qualified_message: e.target.value })}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            placeholder="Great — we'll be in touch shortly."
          />
        </Field>
        <Field label="Disqualified message">
          <textarea
            value={config.outro?.disqualified_message ?? ''}
            onChange={(e) => updateOutro({ disqualified_message: e.target.value })}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            placeholder="Thanks for your time."
          />
        </Field>
        <Field label="Pending review message">
          <textarea
            value={config.outro?.pending_message ?? ''}
            onChange={(e) => updateOutro({ pending_message: e.target.value })}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
            placeholder="Thanks — a teammate will review your answers."
          />
        </Field>
      </Subsection>
    </div>
  )
}

function Subsection({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[#111827]">{title}</h3>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">{label}</span>
      {children}
    </label>
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
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-[#D1D5DB] bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-2 font-mono text-[12px]"
        />
      </div>
    </Field>
  )
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded border border-[#E5E7EB] bg-white text-[12px] text-[#6B7280] hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: { label: string; value: string; score?: number }[]
  onChange: (opts: { label: string; value: string; score?: number }[]) => void
}) {
  const set = (
    idx: number,
    patch: Partial<{ label: string; value: string; score?: number }>,
  ) => {
    const next = [...options]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  const remove = (idx: number) => onChange(options.filter((_, i) => i !== idx))
  const add = () =>
    onChange([
      ...options,
      {
        label: `Option ${options.length + 1}`,
        value: `option_${options.length + 1}`,
        score: 0,
      },
    ])

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#374151]">Options</span>
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
        >
          + Add option
        </button>
      </div>
      {options.length === 0 ? (
        <p className="text-[12px] text-[#6B7280]">No options yet.</p>
      ) : (
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_88px_28px] items-center gap-2">
              <input
                type="text"
                value={opt.label}
                placeholder="Label"
                onChange={(e) => set(i, { label: e.target.value })}
                className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px]"
              />
              <input
                type="text"
                value={opt.value}
                placeholder="value"
                onChange={(e) => set(i, { value: e.target.value })}
                className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 font-mono text-[12px]"
              />
              <input
                type="number"
                value={opt.score ?? 0}
                step="any"
                onChange={(e) => set(i, { score: Number(e.target.value) || 0 })}
                className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px]"
                placeholder="Score"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove option"
                className="flex h-7 w-7 items-center justify-center rounded border border-[#E5E7EB] bg-white text-[12px] text-[#6B7280] hover:bg-[#F3F4F6]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Re-export to keep TS happy with default-config availability if imported later.
export const __DEFAULT__ = DEFAULT_QUALIFICATION_CONFIG
