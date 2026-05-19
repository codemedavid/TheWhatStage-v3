'use client'

import { useMemo, useState } from 'react'
import {
  DEFAULT_FOLLOWUP_SETTINGS,
  type FollowupSettings,
} from '@/lib/followups/settings'

type Unit = 'minutes' | 'hours' | 'days'

interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
  instruction: string
}

interface FormState {
  enabled: boolean
  rows: RowDraft[]
}

const UNIT_FACTOR: Record<Unit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

function msToDraft(offsetMs: number): { value: number; unit: Unit } {
  // Largest unit U such that offsetMs is a whole multiple of one U.
  if (offsetMs % UNIT_FACTOR.days === 0) return { value: offsetMs / UNIT_FACTOR.days, unit: 'days' }
  if (offsetMs % UNIT_FACTOR.hours === 0) return { value: offsetMs / UNIT_FACTOR.hours, unit: 'hours' }
  return { value: Math.round(offsetMs / UNIT_FACTOR.minutes), unit: 'minutes' }
}

function draftToMs(row: RowDraft): number {
  return Math.round(row.value * UNIT_FACTOR[row.unit])
}

function settingsToState(s: FollowupSettings): FormState {
  return {
    enabled: s.enabled,
    rows: s.touchpoints.map((t) => {
      const { value, unit } = msToDraft(t.offset_ms)
      return { enabled: t.enabled, value, unit, instruction: t.instruction }
    }),
  }
}

function stateToSettings(s: FormState): FollowupSettings {
  return {
    enabled: s.enabled,
    touchpoints: s.rows.map((r) => ({
      enabled: r.enabled,
      offset_ms: draftToMs(r),
      instruction: r.instruction,
    })),
  }
}

const MIN_MS = 60_000
const MAX_MS = 7 * 24 * 3_600_000

interface ValidationResult {
  rowErrors: Map<number, string>
  formError: string | null
}

function validate(state: FormState): ValidationResult {
  const rowErrors = new Map<number, string>()
  let formError: string | null = null

  state.rows.forEach((row, idx) => {
    if (!Number.isFinite(row.value) || row.value <= 0) {
      rowErrors.set(idx, 'Enter a positive number.')
      return
    }
    const ms = draftToMs(row)
    if (ms < MIN_MS) {
      rowErrors.set(idx, 'Minimum is 1 minute.')
    } else if (ms > MAX_MS) {
      rowErrors.set(idx, 'Maximum is 7 days.')
    }
  })

  const enabledIndexed = state.rows
    .map((r, idx) => ({ ms: draftToMs(r), enabled: r.enabled, idx }))
    .filter((x) => x.enabled)

  for (let i = 1; i < enabledIndexed.length; i++) {
    if (enabledIndexed[i].ms <= enabledIndexed[i - 1].ms) {
      const prev = enabledIndexed[i - 1].idx + 1
      const cur = enabledIndexed[i].idx + 1
      rowErrors.set(
        enabledIndexed[i].idx,
        `Must be later than touchpoint ${prev}.`,
      )
      formError = `Touchpoint ${cur} must be later than touchpoint ${prev}.`
    }
  }

  if (state.enabled && enabledIndexed.length === 0) {
    formError = 'Enable at least one touchpoint or turn the master toggle off.'
  }

  return { rowErrors, formError }
}

export function AutoFollowupForm({ initial }: { initial: FollowupSettings }) {
  const [baseline, setBaseline] = useState<FollowupSettings>(initial)
  const [state, setState] = useState<FormState>(() => settingsToState(initial))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [topError, setTopError] = useState<string | null>(null)

  const { rowErrors, formError } = useMemo(() => validate(state), [state])
  const dirty = useMemo(
    () => JSON.stringify(stateToSettings(state)) !== JSON.stringify(baseline),
    [state, baseline],
  )
  const canSave = dirty && !formError && rowErrors.size === 0 && !saving

  function setRow(idx: number, patch: Partial<RowDraft>) {
    setState((s) => ({
      ...s,
      rows: s.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }

  function onReset() {
    if (!window.confirm('Reset all touchpoints to the default schedule?')) return
    setState(settingsToState(DEFAULT_FOLLOWUP_SETTINGS))
  }

  function onCancel() {
    setState(settingsToState(baseline))
    setTopError(null)
  }

  async function onSave() {
    setSaving(true)
    setTopError(null)
    try {
      const res = await fetch('/api/chatbot/followup-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: stateToSettings(state) }),
      })
      const body = (await res.json()) as { settings?: FollowupSettings; error?: string }
      if (!res.ok) {
        setTopError(body.error ?? `Save failed (${res.status})`)
        return
      }
      if (body.settings) {
        setBaseline(body.settings)
        setState(settingsToState(body.settings))
      }
      setToast('Auto follow-up updated')
      setTimeout(() => setToast(null), 2500)
    } catch (e) {
      setTopError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="afu-wrap" data-master={state.enabled ? 'on' : 'off'}>
      <header className="afu-header">
        <div>
          <h2 className="afu-title">Auto Follow-Up</h2>
          <p className="afu-help">
            When a lead goes quiet, send up to 7 nudges before stopping.
          </p>
        </div>
        <label className="afu-toggle">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span>{state.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </header>

      <div className="afu-rows-head">
        <span>Touchpoints</span>
        <button type="button" className="afu-link-btn" onClick={onReset}>
          Reset to defaults
        </button>
      </div>

      <ol className="afu-rows">
        {state.rows.map((row, idx) => {
          const err = rowErrors.get(idx)
          return (
            <li key={idx} className={`afu-row${row.enabled ? '' : ' is-disabled'}${err ? ' has-error' : ''}`}>
              <label className="afu-row-check">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => setRow(idx, { enabled: e.target.checked })}
                />
              </label>
              <span className="afu-row-num">{idx + 1}.</span>
              <input
                type="number"
                min={1}
                step={1}
                className="afu-row-value"
                value={row.value}
                onChange={(e) => setRow(idx, { value: Number(e.target.value) })}
                disabled={!row.enabled}
                aria-label={`Touchpoint ${idx + 1} interval value`}
              />
              <select
                className="afu-row-unit"
                value={row.unit}
                onChange={(e) => setRow(idx, { unit: e.target.value as Unit })}
                disabled={!row.enabled}
                aria-label={`Touchpoint ${idx + 1} interval unit`}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <span className="afu-row-suffix">after last reply</span>
              {err && <span className="afu-row-error" role="alert">{err}</span>}
              <div className="afu-row-guide">
                <label className="afu-row-guide-label" htmlFor={`afu-guide-${idx}`}>
                  Guide
                </label>
                <input
                  id={`afu-guide-${idx}`}
                  type="text"
                  className="afu-row-guide-input"
                  maxLength={200}
                  value={row.instruction}
                  onChange={(e) => setRow(idx, { instruction: e.target.value })}
                  disabled={!row.enabled}
                  placeholder="Leave blank to use the default style for this touchpoint."
                  aria-label={`Touchpoint ${idx + 1} message guide`}
                />
                <span className="afu-row-guide-count" aria-hidden="true">
                  {row.instruction.length}/200
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {formError && <div className="afu-form-error" role="alert">{formError}</div>}
      {topError && <div className="afu-form-error" role="alert">{topError}</div>}

      <div className="afu-actions">
        {toast && <span className="afu-toast" role="status">{toast}</span>}
        <button type="button" className="afu-btn-secondary" onClick={onCancel} disabled={!dirty || saving}>
          Cancel
        </button>
        <button type="button" className="afu-btn-primary" onClick={onSave} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
