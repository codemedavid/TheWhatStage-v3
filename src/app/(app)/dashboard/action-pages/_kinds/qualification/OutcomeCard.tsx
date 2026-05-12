'use client'

import type { QualificationOutcomeAction, QualificationQuestion } from '@/app/a/[slug]/_kinds/qualification/schema'
import type { ActionPageOption, PipelineStageOption } from '../../_lib/queries'

function setMatchKind(
  kind: QualificationOutcomeAction['match']['kind'],
  questions: QualificationQuestion[],
  onChange: (patch: Partial<QualificationOutcomeAction>) => void,
) {
  if (kind === 'score_at_least') onChange({ match: { kind, value: 1 } })
  else if (kind === 'score_below') onChange({ match: { kind, value: 1 } })
  else if (kind === 'manual_review') onChange({ match: { kind } })
  else if (kind === 'answer_equals') {
    onChange({ match: { kind, question_id: questions[0]?.id ?? '', value: '' } })
  } else {
    onChange({ match: { kind, question_id: questions[0]?.id ?? '', value: '' } })
  }
}

export function OutcomeCard({
  outcome,
  questions,
  stages,
  actionPages,
  onChange,
  onRemove,
}: {
  outcome: QualificationOutcomeAction
  questions: QualificationQuestion[]
  stages: PipelineStageOption[]
  actionPages: ActionPageOption[]
  onChange: (patch: Partial<QualificationOutcomeAction>) => void
  onRemove: () => void
}) {
  const match = outcome.match

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <input
          value={outcome.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label"
          className="flex-1 rounded border border-[#E5E7EB] px-2 py-1 text-[13px] font-semibold"
        />
        <input
          value={outcome.outcome}
          onChange={(e) => onChange({ outcome: e.target.value })}
          placeholder="outcome_key"
          className="w-40 rounded border border-[#E5E7EB] px-2 py-1 font-mono text-[12px]"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-[#9CA3AF] hover:text-[#EF4444] text-[13px]"
        >
          ✕
        </button>
      </div>

      {/* Match condition */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Match</label>
        <select
          value={match.kind}
          onChange={(e) => setMatchKind(e.target.value as QualificationOutcomeAction['match']['kind'], questions, onChange)}
          className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        >
          <option value="score_at_least">Score at least</option>
          <option value="score_below">Score below</option>
          <option value="manual_review">Manual review</option>
          <option value="answer_equals">Answer equals</option>
          <option value="answer_includes">Answer includes</option>
        </select>
        {(match.kind === 'score_at_least' || match.kind === 'score_below') && (
          <input
            type="number"
            value={match.value}
            onChange={(e) => onChange({ match: { ...match, value: Number(e.target.value) } })}
            className="w-24 rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
          />
        )}
        {(match.kind === 'answer_equals' || match.kind === 'answer_includes') && (
          <div className="flex gap-2">
            <select
              value={match.question_id}
              onChange={(e) => onChange({ match: { ...match, question_id: e.target.value } })}
              className="flex-1 rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
            >
              {questions.map((q) => (
                <option key={q.id} value={q.id}>{q.prompt}</option>
              ))}
            </select>
            <input
              value={String(match.value)}
              onChange={(e) => onChange({ match: { ...match, value: e.target.value } })}
              placeholder="value"
              className="w-32 rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
            />
          </div>
        )}
      </div>

      {/* Stage */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Move to stage</label>
        <select
          value={outcome.to_stage_id ?? ''}
          onChange={(e) => onChange({ to_stage_id: e.target.value || null })}
          className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        >
          <option value="">Default (auto)</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Messenger text */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Messenger reply</label>
        <textarea
          value={outcome.messenger_text}
          onChange={(e) => onChange({ messenger_text: e.target.value })}
          rows={2}
          className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
          placeholder="Message sent in Messenger when this outcome is matched"
        />
      </div>

      {/* Attach action page */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Attach action page</label>
        <select
          value={outcome.attach_action_page_id ?? ''}
          onChange={(e) => onChange({ attach_action_page_id: e.target.value || null })}
          className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        >
          <option value="">None</option>
          {actionPages.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        {outcome.attach_action_page_id && (
          <input
            value={outcome.attach_cta_label}
            onChange={(e) => onChange({ attach_cta_label: e.target.value })}
            placeholder="CTA label (e.g. Book now)"
            className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
          />
        )}
      </div>

      {/* Public message */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide">Public thank-you message</label>
        <textarea
          value={outcome.public_message}
          onChange={(e) => onChange({ public_message: e.target.value })}
          rows={2}
          className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
          placeholder="Shown on the public confirmation page"
        />
      </div>
    </div>
  )
}
