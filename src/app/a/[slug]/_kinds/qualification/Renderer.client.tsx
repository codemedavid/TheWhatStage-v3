'use client'

import { useMemo, useRef, useState } from 'react'
import type {
  QualificationAnswer,
  QualificationAnswers,
  QualificationConfig,
  QualificationQuestion,
} from './schema'

interface Props {
  slug: string
  config: QualificationConfig
  deeplink: { p: string; g: string; e: string; t: string } | null
  sourceContext?: {
    source_property_action_page_id?: string
    source_property_title?: string
    source_property_unit_id?: string
    source_property_unit_title?: string
    source_sales_page_id?: string
    source_sales_page_title?: string
  } | null
}

/**
 * Quiz stepper. Hydrated client experience shows ONE question at a time. The
 * no-JS fallback is the noscript form below — it renders every question on
 * one screen so submission still works without JS (acceptable degradation).
 */
export function QualificationClient({ slug, config, deeplink, sourceContext }: Props) {
  const [answers, setAnswers] = useState<QualificationAnswers>({})
  const [index, setIndex] = useState(0)
  const formRef = useRef<HTMLFormElement | null>(null)

  const total = config.questions.length
  const hasIntro = !!(config.intro?.headline || config.intro?.body)
  const isIntro = hasIntro && index === 0
  const questionIndex = hasIntro ? index - 1 : index
  const onLast = total === 0 ? !isIntro : questionIndex === total - 1

  const setAnswer = (qid: string, value: QualificationAnswer | undefined) =>
    setAnswers((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[qid]
      else next[qid] = value
      return next
    })

  const advance = () => setIndex((i) => i + 1)
  const back = () => setIndex((i) => Math.max(0, i - 1))

  const submit = () => {
    formRef.current?.requestSubmit()
  }

  const currentQuestion: QualificationQuestion | null = useMemo(() => {
    if (isIntro) return null
    return config.questions[questionIndex] ?? null
  }, [config.questions, questionIndex, isIntro])

  const accent = config.theme.accent_color
  const buttonText = config.theme.button_text_color

  // If no questions, show a friendly notice + a no-op submit (so creators see
  // *something* in preview mode).
  if (total === 0 && !hasIntro) {
    return (
      <div className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-8 text-center text-[13px] text-[#6B7280]">
        This qualification quiz has no questions yet.
      </div>
    )
  }

  // Validate the current question before advancing.
  const canAdvance = (() => {
    if (!currentQuestion) return true
    if (!currentQuestion.required) return true
    const a = answers[currentQuestion.id]
    if (a === undefined || a === null) return false
    if (typeof a === 'string' && a.trim() === '') return false
    if (Array.isArray(a) && a.length === 0) return false
    return true
  })()

  const progressDenominator = total + (hasIntro ? 1 : 0)
  const progressNumerator = Math.min(index + 1, progressDenominator)

  return (
    <div className="space-y-4">
      {config.progress_bar && progressDenominator > 0 && (
        <div className="w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className="h-full transition-[width] duration-200"
              style={{
                width: `${(progressNumerator / progressDenominator) * 100}%`,
                backgroundColor: accent,
              }}
            />
          </div>
          <p className="mt-1 text-right text-[11px] text-[#6B7280]">
            {progressNumerator} / {progressDenominator}
          </p>
        </div>
      )}

      <div
        className="rounded-lg border border-[#E5E7EB] p-5"
        style={{ backgroundColor: config.theme.background_color }}
      >
        {isIntro ? (
          <div className="space-y-2">
            {config.intro?.headline && (
              <h2 className="text-[20px] font-semibold text-[#111827]">
                {config.intro.headline}
              </h2>
            )}
            {config.intro?.body && (
              <p className="text-[14px] leading-relaxed text-[#374151]">
                {config.intro.body}
              </p>
            )}
          </div>
        ) : currentQuestion ? (
          <QuestionView
            question={currentQuestion}
            value={answers[currentQuestion.id]}
            onChange={(v) => setAnswer(currentQuestion.id, v)}
            accent={accent}
          />
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
          {onLast ? (
            <button
              type="button"
              onClick={submit}
              disabled={!canAdvance}
              className="rounded-md px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: accent, color: buttonText }}
            >
              Submit
            </button>
          ) : (
            <button
              type="button"
              onClick={advance}
              disabled={!canAdvance}
              className="rounded-md px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: accent, color: buttonText }}
            >
              Next
            </button>
          )}
        </div>
      </div>

      {/* Real form for actual submission (kept hidden once hydrated). */}
      <form
        ref={formRef}
        action="/api/action-pages/submit"
        method="post"
        className="hidden"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="data.answers" value={JSON.stringify(answers)} />
        {deeplink && (
          <>
            <input type="hidden" name="p" value={deeplink.p} />
            <input type="hidden" name="g" value={deeplink.g} />
            <input type="hidden" name="e" value={deeplink.e} />
            <input type="hidden" name="t" value={deeplink.t} />
          </>
        )}
        {sourceContext?.source_property_action_page_id && (
          <>
            <input
              type="hidden"
              name="source_property_action_page_id"
              value={sourceContext.source_property_action_page_id}
            />
            <input
              type="hidden"
              name="source_property_title"
              value={sourceContext.source_property_title ?? ''}
            />
            {sourceContext.source_property_unit_id && (
              <>
                <input
                  type="hidden"
                  name="source_property_unit_id"
                  value={sourceContext.source_property_unit_id}
                />
                <input
                  type="hidden"
                  name="source_property_unit_title"
                  value={sourceContext.source_property_unit_title ?? ''}
                />
              </>
            )}
          </>
        )}
        {sourceContext?.source_sales_page_id && (
          <>
            <input
              type="hidden"
              name="source_sales_page_id"
              value={sourceContext.source_sales_page_id}
            />
            <input
              type="hidden"
              name="source_sales_page_title"
              value={sourceContext.source_sales_page_title ?? ''}
            />
          </>
        )}
      </form>

      {/* No-JS fallback: render every question on one page. */}
      <noscript>
        <form
          action="/api/action-pages/submit"
          method="post"
          className="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-5"
        >
          <input type="hidden" name="slug" value={slug} />
          {deeplink && (
            <>
              <input type="hidden" name="p" value={deeplink.p} />
              <input type="hidden" name="g" value={deeplink.g} />
              <input type="hidden" name="e" value={deeplink.e} />
              <input type="hidden" name="t" value={deeplink.t} />
            </>
          )}
          {sourceContext?.source_property_action_page_id && (
            <>
              <input
                type="hidden"
                name="source_property_action_page_id"
                value={sourceContext.source_property_action_page_id}
              />
              <input
                type="hidden"
                name="source_property_title"
                value={sourceContext.source_property_title ?? ''}
              />
            </>
          )}
          {sourceContext?.source_sales_page_id && (
            <>
              <input
                type="hidden"
                name="source_sales_page_id"
                value={sourceContext.source_sales_page_id}
              />
              <input
                type="hidden"
                name="source_sales_page_title"
                value={sourceContext.source_sales_page_title ?? ''}
              />
            </>
          )}
          {/*
            Without JS we cannot serialize a single JSON blob from many fields
            cleanly, so each question becomes its own data.<id> field. The
            handler treats unknown shapes as zero-contribution; the operator
            should know this and prefer JS-on Messenger users.
          */}
          {config.questions.map((q) => (
            <NoScriptQuestion key={q.id} question={q} />
          ))}
          <button
            type="submit"
            className="rounded-md px-4 py-2 text-[13px] font-semibold"
            style={{ backgroundColor: accent, color: buttonText }}
          >
            Submit
          </button>
        </form>
      </noscript>
    </div>
  )
}

function QuestionView({
  question,
  value,
  onChange,
  accent,
}: {
  question: QualificationQuestion
  value: QualificationAnswer | undefined
  onChange: (v: QualificationAnswer | undefined) => void
  accent: string
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-[18px] font-semibold text-[#111827]">
        {question.prompt || 'Untitled question'}
        {question.required && (
          <span className="ml-1 text-red-500" aria-label="required">
            *
          </span>
        )}
      </h2>

      {question.kind === 'short_text' && (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
          autoFocus
        />
      )}

      {question.kind === 'single_choice' && (
        <div className="space-y-2">
          {(question.options ?? []).map((opt) => {
            const checked = value === opt.value
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[14px]"
                style={{
                  borderColor: checked ? accent : '#D1D5DB',
                  backgroundColor: checked ? `${accent}10` : '#FFFFFF',
                }}
              >
                <input
                  type="radio"
                  name={question.id}
                  checked={checked}
                  onChange={() => onChange(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}

      {question.kind === 'multi_choice' && (
        <div className="space-y-2">
          {(question.options ?? []).map((opt) => {
            const arr = Array.isArray(value) ? value : []
            const checked = arr.includes(opt.value)
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[14px]"
                style={{
                  borderColor: checked ? accent : '#D1D5DB',
                  backgroundColor: checked ? `${accent}10` : '#FFFFFF',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, opt.value])
                    else onChange(arr.filter((v) => v !== opt.value))
                  }}
                />
                <span>{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}

      {question.kind === 'rating' && (
        <RatingInput
          max={question.rating_max ?? 5}
          value={typeof value === 'number' ? value : null}
          onChange={(n) => onChange(n)}
          accent={accent}
        />
      )}
    </div>
  )
}

function RatingInput({
  max,
  value,
  onChange,
  accent,
}: {
  max: number
  value: number | null
  onChange: (n: number) => void
  accent: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = value !== null && n <= value
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`Rate ${n}`}
            className="flex h-10 w-10 items-center justify-center rounded-md border text-[14px] font-semibold"
            style={{
              borderColor: active ? accent : '#D1D5DB',
              backgroundColor: active ? accent : '#FFFFFF',
              color: active ? '#FFFFFF' : '#374151',
            }}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

function NoScriptQuestion({ question }: { question: QualificationQuestion }) {
  const fieldName = `data.${question.id}`
  return (
    <div className="space-y-2">
      <p className="text-[14px] font-semibold text-[#111827]">
        {question.prompt || 'Untitled question'}
        {question.required && <span className="ml-1 text-red-500">*</span>}
      </p>
      {question.kind === 'short_text' && (
        <input
          type="text"
          name={fieldName}
          required={question.required}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
        />
      )}
      {question.kind === 'single_choice' && (
        <div className="space-y-1">
          {(question.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-[13px]">
              <input
                type="radio"
                name={fieldName}
                value={opt.value}
                required={question.required}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
      {question.kind === 'multi_choice' && (
        <div className="space-y-1">
          {(question.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name={fieldName} value={opt.value} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
      {question.kind === 'rating' && (
        <input
          type="number"
          name={fieldName}
          min={1}
          max={question.rating_max ?? 5}
          required={question.required}
          className="w-24 rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
        />
      )}
    </div>
  )
}
