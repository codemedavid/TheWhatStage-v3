'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  ACTION_PAGE_KINDS,
  KIND_REGISTRY,
  type ActionPageKind,
} from '@/lib/action-pages/kinds'
import { createActionPage } from '../actions/crud'
import { ActionPagePreview, KIND_ICON } from './ActionPagePreview'

type StepId = 'kind' | 'details' | 'review'
const STEPS: { id: StepId; label: string }[] = [
  { id: 'kind', label: 'Choose type' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review' },
]

const KIND_TAGLINE: Record<ActionPageKind, string> = {
  form: 'Best for capturing structured info from new leads.',
  booking: 'Best for letting prospects pick a meeting time.',
  qualification: 'Best for filtering leads with a quick quiz.',
  sales: 'Best for a focused offer page with one CTA.',
  catalog: 'Best for selling multiple products with a cart.',
  realestate: 'Best for property listings with viewing requests.',
}

export function NewActionPageWizard({ initialError }: { initialError: string | null }) {
  const [step, setStep] = useState<StepId>('kind')
  const [kind, setKind] = useState<ActionPageKind>('form')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const canContinue =
    (step === 'kind' && !!kind) ||
    (step === 'details' && title.trim().length >= 1) ||
    step === 'review'

  function next() {
    if (step === 'kind') setStep('details')
    else if (step === 'details') setStep('review')
  }
  function back() {
    if (step === 'details') setStep('kind')
    else if (step === 'review') setStep('details')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <Link
          href="/dashboard/action-pages"
          className="text-[12px] text-[#6B7280] hover:text-[#111827]"
        >
          ← Back to action pages
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#111827]">
          New action page
        </h1>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          A short setup. You can fine-tune everything after creating.
        </p>
      </header>

      <Stepper current={stepIndex} />

      {initialError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {initialError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5">
          {step === 'kind' && (
            <StepKind selected={kind} onSelect={setKind} />
          )}
          {step === 'details' && (
            <StepDetails
              title={title}
              description={description}
              onTitle={setTitle}
              onDescription={setDescription}
            />
          )}
          {step === 'review' && (
            <StepReview kind={kind} title={title} description={description} />
          )}

          <div className="mt-6 flex items-center justify-between border-t border-[#F3F4F6] pt-4">
            <Link
              href="/dashboard/action-pages"
              className="text-[13px] text-[#6B7280] hover:text-[#111827]"
            >
              Cancel
            </Link>
            <div className="flex gap-2">
              {step !== 'kind' && (
                <button
                  type="button"
                  onClick={back}
                  className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                >
                  Back
                </button>
              )}
              {step !== 'review' ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={!canContinue}
                  className="rounded-md bg-[#059669] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <CreateForm kind={kind} title={title} description={description} />
              )}
            </div>
          </div>
        </div>

        <ActionPagePreview kind={kind} title={title} description={description} />
      </div>
    </div>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo'
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <span
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ' +
                (state === 'active'
                  ? 'bg-[#059669] text-white'
                  : state === 'done'
                    ? 'bg-[#D1FAE5] text-[#065F46]'
                    : 'bg-[#F3F4F6] text-[#6B7280]')
              }
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span
              className={
                'text-[12px] font-medium ' +
                (state === 'todo' ? 'text-[#9CA3AF]' : 'text-[#111827]')
              }
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="ml-1 hidden h-px flex-1 bg-[#E5E7EB] sm:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StepKind({
  selected,
  onSelect,
}: {
  selected: ActionPageKind
  onSelect: (k: ActionPageKind) => void
}) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold text-[#111827]">
        What do you want to build?
      </h2>
      <p className="mt-0.5 text-[13px] text-[#6B7280]">
        Pick a starting point. Each one comes pre-wired so you only configure
        the parts that matter.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ACTION_PAGE_KINDS.map((id) => {
          const meta = KIND_REGISTRY[id]
          const isSelected = selected === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={
                'group flex items-start gap-3 rounded-lg border bg-white p-4 text-left transition ' +
                (isSelected
                  ? 'border-[#059669] bg-[rgba(5,150,105,0.04)] ring-2 ring-[rgba(5,150,105,0.15)]'
                  : 'border-[#E5E7EB] hover:border-[#A7F3D0]')
              }
            >
              <span
                className={
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md ' +
                  (isSelected
                    ? 'bg-[#059669] text-white'
                    : 'bg-[#F3F4F6] text-[#374151]')
                }
              >
                {KIND_ICON[id]}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[#111827]">
                  {meta.label}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[#6B7280]">
                  {meta.blurb}
                </span>
                <span className="mt-1.5 block text-[11px] text-[#9CA3AF]">
                  {KIND_TAGLINE[id]}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepDetails({
  title,
  description,
  onTitle,
  onDescription,
}: {
  title: string
  description: string
  onTitle: (v: string) => void
  onDescription: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-[#111827]">
          Name your page
        </h2>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          The title shows up at the top of the public page. The slug is auto-generated
          and can be changed later.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#374151]">Title</span>
          <span className="text-[11px] text-[#9CA3AF]">{title.length}/120</span>
        </span>
        <input
          autoFocus
          value={title}
          onChange={(e) => onTitle(e.target.value.slice(0, 120))}
          maxLength={120}
          required
          placeholder="e.g. Book a discovery call"
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[rgba(5,150,105,0.15)]"
        />
      </label>

      <label className="block">
        <span className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#374151]">
            Description <span className="font-normal text-[#9CA3AF]">(optional)</span>
          </span>
          <span className="text-[11px] text-[#9CA3AF]">{description.length}/2000</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
          maxLength={2000}
          rows={3}
          placeholder="A short blurb shown beneath the title."
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[rgba(5,150,105,0.15)]"
        />
      </label>
    </div>
  )
}

function StepReview({
  kind,
  title,
  description,
}: {
  kind: ActionPageKind
  title: string
  description: string
}) {
  const meta = KIND_REGISTRY[kind]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-[#111827]">
          Ready to create
        </h2>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">
          We&apos;ll create the page as a draft. You can publish it once you&apos;ve
          finished configuring it.
        </p>
      </div>
      <dl className="divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB]">
        <ReviewRow label="Type" value={meta.label} />
        <ReviewRow label="Title" value={title || '—'} />
        <ReviewRow
          label="Description"
          value={description || <span className="text-[#9CA3AF]">None</span>}
        />
        <ReviewRow label="Status" value="Draft" />
      </dl>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-4 py-2.5">
      <dt className="w-28 shrink-0 text-[12px] font-semibold text-[#6B7280]">
        {label}
      </dt>
      <dd className="text-[13px] text-[#111827]">{value}</dd>
    </div>
  )
}

function CreateForm({
  kind,
  title,
  description,
}: {
  kind: ActionPageKind
  title: string
  description: string
}) {
  return (
    <form action={createActionPage}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="description" value={description} />
      <CreateButton />
    </form>
  )
}

function CreateButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[#059669] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create action page'}
    </button>
  )
}

