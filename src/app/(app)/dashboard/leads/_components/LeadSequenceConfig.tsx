'use client'
import { useEffect, useState, useTransition } from 'react'
import {
  loadLeadSequence,
  saveLeadSequence,
  enrollLeadSequence,
  cancelLeadSequence,
  type LeadSequenceRunInfo,
} from '../actions/sequences'

type Step = { delay_minutes: number; instruction: string }

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

export function LeadSequenceConfig({ leadId }: { leadId: string }) {
  const [enabled, setEnabled] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [run, setRun] = useState<LeadSequenceRunInfo>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [enrolling, startEnroll] = useTransition()
  const [, startLoad] = useTransition()

  const refresh = (signal?: { cancelled: boolean }) =>
    loadLeadSequence(leadId)
      .then((seq) => {
        if (signal?.cancelled) return
        setEnabled(seq.enabled)
        setSteps(seq.steps.map((s) => ({ delay_minutes: s.delay_minutes, instruction: s.instruction })))
        setRun(seq.run)
      })
      .catch((e) => { if (!signal?.cancelled) setError(e instanceof Error ? e.message : 'Failed to load') })

  useEffect(() => {
    const signal = { cancelled: false }
    startLoad(() => setLoading(true))
    refresh(signal).finally(() => { if (!signal.cancelled) startLoad(() => setLoading(false)) })
    return () => { signal.cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId])

  const addStep = () => setSteps((s) => [...s, { delay_minutes: 1440, instruction: '' }])
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i))
  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))

  const save = () => {
    setError(null); setSaved(false)
    const clean = steps.filter((s) => s.instruction.trim() !== '')
    start(async () => {
      try {
        await saveLeadSequence({
          lead_id: leadId,
          enabled,
          steps: clean.map((s) => ({ delay_minutes: s.delay_minutes, instruction: s.instruction.trim(), channel: 'messenger' as const })),
        })
        setSaved(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }

  const startSequence = () => {
    setError(null); setSaved(false)
    const clean = steps.filter((s) => s.instruction.trim() !== '')
    startEnroll(async () => {
      try {
        // Persist the on-screen config first so Start always enrolls what the
        // user sees (and never errors with "save first").
        await saveLeadSequence({
          lead_id: leadId,
          enabled,
          steps: clean.map((s) => ({ delay_minutes: s.delay_minutes, instruction: s.instruction.trim(), channel: 'messenger' as const })),
        })
        await enrollLeadSequence(leadId)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start')
      }
    })
  }

  const stopSequence = () => {
    setError(null)
    startEnroll(async () => {
      try {
        await cancelLeadSequence(leadId)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to stop')
      }
    })
  }

  if (loading) return <div className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>Loading sequence…</div>

  const active = run?.status === 'pending' || run?.status === 'running'
  const cleanCount = steps.filter((s) => s.instruction.trim() !== '').length

  return (
    <div className="space-y-3">
      <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Follow-up sequence for <strong>this lead</strong>. Each step the assistant sends is timed from when you start
        it, guided by your instruction plus the lead&apos;s active project AI instructions (if any).
      </p>

      {active && run && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5"
          style={{ background: 'var(--lead-accent-soft)', border: '1px solid var(--lead-line)' }}
        >
          <span className="text-[12.5px]" style={{ color: 'var(--lead-accent)' }}>
            Running · step {run.next_step_idx + 1} · next {new Date(run.next_run_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </span>
          <button
            type="button"
            onClick={stopSequence}
            disabled={enrolling}
            className="shrink-0 text-[12px] font-medium disabled:opacity-50"
            style={{ color: '#dc2626' }}
          >
            {enrolling ? '…' : 'Stop'}
          </button>
        </div>
      )}

      <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--lead-ink)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable automated follow-ups for this lead
      </label>

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
              <span className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>minutes after start</span>
              {PRESETS.map((p) => (
                <button key={p.minutes} type="button" onClick={() => updateStep(i, { delay_minutes: p.minutes })} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}>{p.label}</button>
              ))}
            </div>
            <textarea
              value={s.instruction}
              onChange={(e) => updateStep(i, { instruction: e.target.value })}
              rows={2}
              placeholder="What should the assistant follow up about at this step?"
              className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={addStep} className="text-[12.5px] font-medium" style={{ color: 'var(--lead-accent)' }}>+ Add follow-up step</button>

      {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
      {saved && <div className="text-[12px]" style={{ color: '#16a34a' }}>Saved.</div>}

      <div className="flex items-center justify-between gap-2">
        {!active && (
          <button
            type="button"
            onClick={startSequence}
            disabled={enrolling || !enabled || cleanCount === 0}
            className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--lead-accent)', color: 'var(--lead-accent)' }}
            title={!enabled ? 'Enable the sequence first' : cleanCount === 0 ? 'Add a step first' : 'Start following up now'}
          >
            {enrolling ? 'Starting…' : 'Start follow-ups'}
          </button>
        )}
        <button type="button" onClick={save} disabled={pending} className="ml-auto rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
          {pending ? 'Saving…' : 'Save sequence'}
        </button>
      </div>
    </div>
  )
}
