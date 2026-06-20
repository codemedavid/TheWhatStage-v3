'use client'
import { useEffect, useState, useTransition } from 'react'
import { saveStageSequence, loadStageSequence } from '../actions/sequences'
import {
  loadStagePreviewProjects,
  previewStageSequence,
  type SequencePreviewTouch,
} from '../actions/sequences'
import type { StagePreviewProject } from '../_lib/queries'

type Step = { delay_minutes: number; instruction: string; fallback_message: string }

const PRESETS: { label: string; minutes: number }[] = [
  { label: '5 min', minutes: 5 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
]

function humanizeDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} d`
}

// Rules are edited as one-per-line text and stored as string arrays.
function linesToList(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

export function SequenceConfig({ stageId, stageName }: { stageId: string; stageName: string }) {
  const [enabled, setEnabled] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
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
          delay_minutes: s.delay_minutes,
          instruction: s.instruction,
          fallback_message: s.fallback_message ?? '',
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

  const addStep = () => setSteps((s) => [...s, { delay_minutes: 1440, instruction: '', fallback_message: '' }])
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i))
  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))

  const cleanSteps = () => steps.filter((s) => s.instruction.trim() !== '')

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
          steps: clean.map((s) => ({
            delay_minutes: s.delay_minutes,
            instruction: s.instruction.trim(),
            fallback_message: s.fallback_message.trim() || null,
            channel: 'messenger' as const,
          })),
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
    if (clean.length === 0) { setPreviewError('Add at least one step with an instruction first.'); return }
    startPreview(async () => {
      try {
        const result = await previewStageSequence({
          stage_id: stageId,
          project_id: previewProjectId,
          stage_instructions: stageInstructions.trim() || null,
          do_rules: linesToList(doRules),
          dont_rules: linesToList(dontRules),
          steps: clean.map((s) => ({
            delay_minutes: s.delay_minutes,
            instruction: s.instruction.trim(),
            fallback_message: s.fallback_message.trim() || null,
            channel: 'messenger' as const,
          })),
        })
        if (!result.ok) { setPreviewError(result.error); return }
        setPreview(result.touches)
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : 'Failed to generate preview')
      }
    })
  }

  if (loading) return <div className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>Loading sequence…</div>

  return (
    <div className="space-y-3">
      <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Follow-up sequence for the <strong>{stageName}</strong> stage. Each step is timed from when a project enters
        the stage and is written by the assistant from your instruction plus the project&apos;s AI instructions.
        Saving also enrolls projects already in this stage. If the assistant can&apos;t draft a step, its fallback
        message is sent instead.
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
      <div className="rounded-lg border p-2.5 space-y-2" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)' }}>
        <div className="text-[11.5px] font-medium" style={{ color: 'var(--lead-body)' }}>
          How to follow up at this stage
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          Tone and strategy for <em>every</em> card in this stage — layered on top of your chatbot&apos;s persona and rules.
        </p>
        <textarea
          value={stageInstructions}
          onChange={(e) => setStageInstructions(e.target.value)}
          rows={2}
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
              rows={3}
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
              rows={3}
              placeholder={'Don’t reopen pricing\nDon’t sound desperate'}
              className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)' }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-medium" style={{ color: 'var(--lead-body)' }}>
                Touch {i + 1} · after {humanizeDelay(s.delay_minutes)}
              </span>
              <button type="button" onClick={() => removeStep(i)} className="text-[11.5px]" style={{ color: '#dc2626' }}>Remove</button>
            </div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                value={s.delay_minutes}
                onChange={(e) => updateStep(i, { delay_minutes: Math.max(0, Number(e.target.value) || 0) })}
                className="w-20 rounded-md border px-2 py-1 text-[12.5px]"
                style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
              />
              <span className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>minutes after entry</span>
              {PRESETS.map((p) => (
                <button key={p.minutes} type="button" onClick={() => updateStep(i, { delay_minutes: p.minutes })} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}>{p.label}</button>
              ))}
            </div>
            <textarea
              value={s.instruction}
              onChange={(e) => updateStep(i, { instruction: e.target.value })}
              rows={2}
              placeholder="Generic goal for this step (e.g. 'Follow up on the pending payment'). No customer names — those live on each card's AI instructions."
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
            <textarea
              value={s.fallback_message}
              onChange={(e) => updateStep(i, { fallback_message: e.target.value })}
              rows={2}
              placeholder="Fallback message — sent as-is if the AI can't draft this step (optional)"
              className="mt-1.5 w-full rounded-md border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={addStep} className="text-[12.5px] font-medium" style={{ color: 'var(--lead-accent)' }}>+ Add follow-up step</button>

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
      <div className="rounded-lg border p-2.5 space-y-2" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)' }}>
        <div className="text-[11.5px] font-medium" style={{ color: 'var(--lead-body)' }}>Test preview</div>
        <p className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          Generate the whole sequence for one lead (in a single pass) to see what would be sent. Nothing is sent.
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
