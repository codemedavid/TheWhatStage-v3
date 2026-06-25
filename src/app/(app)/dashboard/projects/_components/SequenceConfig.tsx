'use client'
import { useEffect, useState, useTransition } from 'react'
import { saveStageSequence, loadStageSequence } from '../actions/sequences'
import {
  loadStagePreviewProjects,
  previewStageSequence,
  type SequencePreviewTouch,
} from '../actions/sequences'
import type { StagePreviewProject } from '../_lib/queries'
import { humanizeDelay } from '../_lib/sequence-format'
import { StepEditor, newUid, type EditorStep } from './StepEditor.client'

// Rules are edited as one-per-line text and stored as string arrays.
function linesToList(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

// A manual-only step (verbatim message, no AI instruction) is valid at runtime —
// the engine sends manual_message and never reads instruction. The DB still
// requires a non-empty instruction, so persist this placeholder for such steps
// instead of silently dropping them.
const MANUAL_ONLY_INSTRUCTION = 'Send the operator-written message for this step.'

// A step worth persisting has either an AI instruction or a manual message.
function stepHasContent(s: { instruction: string; manual_message: string }): boolean {
  return s.instruction.trim() !== '' || s.manual_message.trim() !== ''
}

export function SequenceConfig({ stageId, stageName }: { stageId: string; stageName: string }) {
  const [enabled, setEnabled] = useState(false)
  const [steps, setSteps] = useState<EditorStep[]>([])
  const [stageInstructions, setStageInstructions] = useState('')
  const [doRules, setDoRules] = useState('')
  const [dontRules, setDontRules] = useState('')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [seeded, setSeeded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Test-preview state.
  const [previewProjects, setPreviewProjects] = useState<StagePreviewProject[]>([])
  const [previewProjectId, setPreviewProjectId] = useState('')
  const [preview, setPreview] = useState<SequencePreviewTouch[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, startPreview] = useTransition()

  useEffect(() => {
    let cancelled = false
    loadStageSequence(stageId)
      .then((seq) => {
        if (cancelled) return
        setEnabled(seq.enabled)
        setSteps(seq.steps.map((s) => ({
          uid: newUid(),
          delay_minutes: s.delay_minutes,
          instruction: s.instruction,
          manual_message: s.manual_message ?? '',
          fallback_message: s.fallback_message ?? '',
          enabled: s.enabled,
        })))
        setStageInstructions(seq.stage_instructions ?? '')
        setDoRules(seq.do_rules.join('\n'))
        setDontRules(seq.dont_rules.join('\n'))
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [stageId])

  // Load the project (lead) picker for the preview, lazily.
  useEffect(() => {
    let cancelled = false
    loadStagePreviewProjects(stageId)
      .then((rows) => { if (!cancelled) setPreviewProjects(rows) })
      .catch(() => { /* preview picker is best-effort */ })
    return () => { cancelled = true }
  }, [stageId])

  // Persist any step with real content (AI instruction OR a manual message);
  // disabled steps are kept too so they survive reload. Truly-empty rows drop.
  const cleanSteps = () => steps.filter(stepHasContent)

  const toPayloadStep = (s: EditorStep) => {
    const instruction = s.instruction.trim()
    const manual = s.manual_message.trim()
    return {
      delay_minutes: s.delay_minutes,
      // Manual-only steps have no AI instruction; store a placeholder so the
      // DB's non-empty-instruction constraint is met (it is never read at send).
      instruction: instruction || (manual ? MANUAL_ONLY_INSTRUCTION : ''),
      manual_message: manual || null,
      fallback_message: s.fallback_message.trim() || null,
      channel: 'messenger' as const,
      enabled: s.enabled,
    }
  }

  const save = () => {
    setError(null); setSaved(false); setSeeded(null)
    const clean = cleanSteps()
    start(async () => {
      try {
        const result = await saveStageSequence({
          stage_id: stageId,
          enabled,
          stage_instructions: stageInstructions.trim() || null,
          do_rules: linesToList(doRules),
          dont_rules: linesToList(dontRules),
          steps: clean.map(toPayloadStep),
        })
        if (!result.ok) { setError(result.error); return }
        setSaved(true)
        setSeeded(result.seeded)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }

  const runPreview = () => {
    setPreviewError(null); setPreview(null)
    const clean = cleanSteps()
    if (!previewProjectId) { setPreviewError('Pick a lead to preview against.'); return }
    if (clean.length === 0) { setPreviewError('Add at least one step with an instruction or manual message first.'); return }
    if (!clean.some((s) => s.enabled)) { setPreviewError('Enable at least one step to preview.'); return }
    startPreview(async () => {
      try {
        const result = await previewStageSequence({
          stage_id: stageId,
          project_id: previewProjectId,
          stage_instructions: stageInstructions.trim() || null,
          do_rules: linesToList(doRules),
          dont_rules: linesToList(dontRules),
          steps: clean.map(toPayloadStep),
        })
        if (!result.ok) { setPreviewError(result.error); return }
        setPreview(result.touches)
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : 'Failed to generate preview')
      }
    })
  }

  if (loading) return <div className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>Loading sequence…</div>

  // Count over the same predicate used for saving, so the header never shows a
  // higher "total" than what actually persists (blank placeholder rows excluded).
  const enabledCount = steps.filter((s) => s.enabled && stepHasContent(s)).length
  const totalCount = steps.filter(stepHasContent).length

  return (
    <div className="space-y-4">
      <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Follow-up sequence for the <strong>{stageName}</strong> stage. Each step is timed from when a project enters
        the stage and is written by the assistant from your instruction plus the project&apos;s AI instructions — or you
        can write a manual message to send exactly as typed instead. Saving also enrolls projects already in this stage.
        If the assistant can&apos;t draft a step, its fallback message is sent instead.
      </p>
      <p className="text-[12px]" style={{ color: 'var(--lead-muted)' }}>
        <strong>Keep step instructions generic</strong> — they apply to <em>every</em> card in this stage. Put
        customer-specific details (names, what was quoted, what&apos;s pending) in each card&apos;s own AI instructions,
        not here. Writing one customer&apos;s details in a step will send them to everyone.
      </p>

      <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--lead-ink)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable automated follow-ups for this stage
      </label>

      {/* Per-stage AI guidance + rules */}
      <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)' }}>
        <div className="text-[12px] font-medium" style={{ color: 'var(--lead-body)' }}>
          How to follow up at this stage
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          Tone and strategy for <em>every</em> card in this stage — layered on top of your chatbot&apos;s persona and rules.
        </p>
        <textarea
          value={stageInstructions}
          onChange={(e) => setStageInstructions(e.target.value)}
          rows={3}
          placeholder="e.g. This is the negotiation stage — be warm but assertive about moving toward a decision."
          className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
          style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-medium" style={{ color: 'var(--lead-body)' }}>Do (one per line)</div>
            <textarea
              value={doRules}
              onChange={(e) => setDoRules(e.target.value)}
              rows={4}
              placeholder={'Reference the agreed scope\nOffer a clear next step'}
              className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium" style={{ color: 'var(--lead-body)' }}>Don&apos;t (one per line)</div>
            <textarea
              value={dontRules}
              onChange={(e) => setDontRules(e.target.value)}
              rows={4}
              placeholder={'Don’t reopen pricing\nDon’t sound desperate'}
              className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
          </div>
        </div>
      </div>

      {/* Ordered touches — drag to reorder, duplicate, or toggle off */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium" style={{ color: 'var(--lead-body)' }}>
            Follow-up steps
          </div>
          <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
            {enabledCount} active · {totalCount} total
          </span>
        </div>
        <StepEditor steps={steps} onChange={setSteps} />
      </div>

      {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
      {saved && (
        <div className="text-[12px]" style={{ color: '#16a34a' }}>
          Saved.{seeded && seeded > 0
            ? ` Enrolled ${seeded} project${seeded === 1 ? '' : 's'} already in this stage — first follow-up sends within a minute.`
            : ''}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={pending} className="rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
          {pending ? 'Saving…' : 'Save sequence'}
        </button>
      </div>

      {/* Test preview — draft the whole sequence for one lead without sending */}
      <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)' }}>
        <div className="text-[12px] font-medium" style={{ color: 'var(--lead-body)' }}>Test preview</div>
        <p className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          Generate the whole sequence for one lead (in a single pass) to see what would be sent. Disabled steps are
          skipped, exactly like the live engine. Nothing is sent.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={previewProjectId}
            onChange={(e) => setPreviewProjectId(e.target.value)}
            className="flex-1 rounded-md border px-2 py-1 text-[12.5px]"
            style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
          >
            <option value="">{previewProjects.length ? 'Pick a lead…' : 'No leads in this stage'}</option>
            {previewProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.lead_name ? `${p.lead_name} — ${p.title}` : p.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing}
            className="rounded-md px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
            style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
          >
            {previewing ? 'Generating…' : 'Generate preview'}
          </button>
        </div>

        {previewError && <div className="text-[12px]" style={{ color: '#dc2626' }}>{previewError}</div>}

        {preview && (
          <div className="space-y-1.5">
            {preview.map((t) => (
              <div key={t.position} className="rounded-md border px-2.5 py-1.5" style={{ borderColor: 'var(--lead-line)' }}>
                <div className="mb-0.5 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                  Touch {t.position + 1} · after {humanizeDelay(t.delay_minutes)}
                </div>
                {t.text
                  ? <div className="text-[13px] whitespace-pre-wrap" style={{ color: 'var(--lead-ink)' }}>{t.text}</div>
                  : <div className="text-[12.5px] italic" style={{ color: 'var(--lead-muted)' }}>No AI draft — the fallback message would be sent.</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
