'use client'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DELAY_PRESETS, humanizeDelay } from '../_lib/sequence-format'
import { MAX_SEQUENCE_STEPS } from '../_lib/schemas'

// crypto.randomUUID is secure-context only (undefined on plain-HTTP LAN/dev
// origins). Mirror the guarded pattern used elsewhere in the app so the editor
// degrades gracefully off-HTTPS. Only ever called in handlers/effects, never
// during render, so there is no SSR/hydration concern.
export function newUid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// Editor-only step shape. `uid` is a stable client id for dnd reordering and
// React keys — it is NOT persisted (the server re-derives `position` from order
// on save). Mirrors the server SequenceStepInput fields otherwise.
export type EditorStep = {
  uid: string
  delay_minutes: number
  instruction: string
  manual_message: string
  fallback_message: string
  enabled: boolean
}

// Sourced from the schema so the UI cap and the server cap can never drift.
export const MAX_STEPS = MAX_SEQUENCE_STEPS

const inputBase = {
  borderColor: 'var(--lead-line)',
  background: 'var(--lead-surface)',
  color: 'var(--lead-ink)',
} as const

export function newEditorStep(): EditorStep {
  return {
    uid: newUid(),
    delay_minutes: 1440,
    instruction: '',
    manual_message: '',
    fallback_message: '',
    enabled: true,
  }
}

// Ordered list of follow-up touches. Owns reorder / duplicate / remove / toggle
// and emits the full next array via onChange (immutable — never mutates props).
export function StepEditor({
  steps,
  onChange,
}: {
  steps: EditorStep[]
  onChange: (steps: EditorStep[]) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const update = (uid: string, patch: Partial<EditorStep>) =>
    onChange(steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
  const remove = (uid: string) => onChange(steps.filter((s) => s.uid !== uid))
  const duplicate = (uid: string) => {
    const i = steps.findIndex((s) => s.uid === uid)
    if (i < 0 || steps.length >= MAX_STEPS) return
    const copy: EditorStep = { ...steps[i], uid: newUid() }
    onChange([...steps.slice(0, i + 1), copy, ...steps.slice(i + 1)])
  }
  const add = () => {
    if (steps.length < MAX_STEPS) onChange([...steps, newEditorStep()])
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = steps.findIndex((s) => s.uid === active.id)
    const to = steps.findIndex((s) => s.uid === over.id)
    if (from < 0 || to < 0) return
    onChange(arrayMove(steps, from, to))
  }

  return (
    <div className="space-y-2">
      <DndContext id="sequence-steps" sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.uid)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {steps.map((s, i) => (
              <SortableStep
                key={s.uid}
                step={s}
                index={i}
                canDuplicate={steps.length < MAX_STEPS}
                onUpdate={update}
                onRemove={remove}
                onDuplicate={duplicate}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {steps.length === 0 && (
        <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
          No steps yet — add the first follow-up touch below.
        </p>
      )}

      <button
        type="button"
        onClick={add}
        disabled={steps.length >= MAX_STEPS}
        className="text-[12.5px] font-medium disabled:opacity-50"
        style={{ color: 'var(--lead-accent)' }}
      >
        + Add follow-up step{steps.length >= MAX_STEPS ? ` (max ${MAX_STEPS})` : ''}
      </button>
    </div>
  )
}

function Grip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

function SortableStep({
  step,
  index,
  canDuplicate,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  step: EditorStep
  index: number
  canDuplicate: boolean
  onUpdate: (uid: string, patch: Partial<EditorStep>) => void
  onRemove: (uid: string) => void
  onDuplicate: (uid: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.uid })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : step.enabled ? 1 : 0.55,
    borderColor: 'var(--lead-line)',
    background: 'var(--lead-surface)',
  }

  const isManual = step.manual_message.trim() !== ''

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          aria-label={`Reorder step ${index + 1}`}
          className="lead-focus -ml-1 cursor-grab rounded p-0.5 active:cursor-grabbing"
          style={{ color: 'var(--lead-muted)', touchAction: 'none' }}
        >
          <Grip />
        </button>
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--lead-body)' }}>
          Touch {index + 1} · after {humanizeDelay(step.delay_minutes)}
        </span>
        {!step.enabled && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--lead-surface-2)', color: 'var(--lead-muted)', border: '1px solid var(--lead-line)' }}
          >
            Disabled
          </span>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <label className="flex cursor-pointer items-center gap-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(e) => onUpdate(step.uid, { enabled: e.target.checked })}
              aria-label={`Step ${index + 1} enabled`}
            />
            On
          </label>
          <button
            type="button"
            onClick={() => onDuplicate(step.uid)}
            disabled={!canDuplicate}
            className="text-[11.5px] font-medium disabled:opacity-40"
            style={{ color: 'var(--lead-accent)' }}
          >
            Duplicate
          </button>
          <button type="button" onClick={() => onRemove(step.uid)} className="text-[11.5px] font-medium" style={{ color: '#dc2626' }}>
            Remove
          </button>
        </div>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={step.delay_minutes}
          onChange={(e) => onUpdate(step.uid, { delay_minutes: Math.max(0, Number(e.target.value) || 0) })}
          className="w-20 rounded-md border px-2 py-1 text-[12.5px]"
          style={inputBase}
        />
        <span className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>minutes after entry</span>
        {DELAY_PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            onClick={() => onUpdate(step.uid, { delay_minutes: p.minutes })}
            className="rounded-full px-2 py-0.5 text-[10.5px]"
            style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        value={step.instruction}
        onChange={(e) => onUpdate(step.uid, { instruction: e.target.value })}
        rows={2}
        placeholder="Generic goal for this step (e.g. 'Follow up on the pending payment'). No customer names — those live on each card's AI instructions."
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
        style={inputBase}
      />
      <textarea
        value={step.manual_message}
        onChange={(e) => onUpdate(step.uid, { manual_message: e.target.value })}
        rows={2}
        placeholder="Write your own message to send instead of the AI draft (optional). Sent exactly as typed to every card in this stage — leave blank to let the assistant write it."
        className="mt-1.5 w-full rounded-md border px-2.5 py-1.5 text-[13px]"
        style={{ ...inputBase, borderColor: 'var(--lead-accent)' }}
      />
      {isManual && (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--lead-accent)' }}>
          Manual message — this touch is sent exactly as written; the AI won&apos;t rewrite it.
        </div>
      )}
      <textarea
        value={step.fallback_message}
        onChange={(e) => onUpdate(step.uid, { fallback_message: e.target.value })}
        rows={2}
        placeholder="Fallback message — sent as-is if the AI can't draft this step (optional)"
        className="mt-1.5 w-full rounded-md border px-2.5 py-1.5 text-[13px]"
        style={inputBase}
      />
    </div>
  )
}
