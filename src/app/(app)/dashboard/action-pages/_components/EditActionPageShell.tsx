'use client'

import Link from 'next/link'
import { useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import type { ActionPageRow } from '../_lib/queries'
import type { PipelineRule } from '../_lib/schemas'
import { updateActionPage, deleteActionPage } from '../actions/crud'
import { ActionPagePreview } from './ActionPagePreview'
import { CopyField } from './CopyField'
import { KindEditor } from './KindEditor'
import { PipelineRulesEditor } from './PipelineRulesEditor'
import { CatalogShell } from '../_kinds/catalog/CatalogShell'

type StepId = 'general' | 'configuration' | 'workflow' | 'share'

const STEPS: { id: StepId; label: string; sub: string }[] = [
  { id: 'general', label: 'General', sub: 'Title, slug, status' },
  { id: 'configuration', label: 'Configuration', sub: 'Page contents' },
  { id: 'workflow', label: 'Workflow', sub: 'Pipeline + replies' },
  { id: 'share', label: 'Share', sub: 'Links and embed' },
]

const STATUS_OPTIONS: { v: ActionPageRow['status']; l: string }[] = [
  { v: 'draft', l: 'Draft' },
  { v: 'published', l: 'Live' },
  { v: 'archived', l: 'Archived' },
]

export function EditActionPageShell({
  page,
  stages,
  publicUrl,
  embedUrl,
  embedSnippet,
  saved,
  errorBanner,
}: {
  page: ActionPageRow
  stages: { id: string; name: string }[]
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  saved: boolean
  errorBanner: string | null
}) {
  if (page.kind === 'catalog') {
    return (
      <CatalogShell
        page={page}
        stages={stages}
        publicUrl={publicUrl}
        embedUrl={embedUrl}
        embedSnippet={embedSnippet}
        saved={saved}
        errorBanner={errorBanner}
      />
    )
  }

  const meta = KIND_REGISTRY[page.kind]
  const [step, setStep] = useState<number>(0)
  const [completed, setCompleted] = useState<number[]>([])
  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description ?? '')
  const [slug, setSlug] = useState(page.slug)
  const [status, setStatus] = useState<ActionPageRow['status']>(page.status)
  const [liveConfig, setLiveConfig] = useState<Record<string, unknown>>(
    page.config,
  )
  const [showPreview, setShowPreview] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)

  const accent = (liveConfig as { theme?: { accent_color?: string } })?.theme
    ?.accent_color

  function handleFormInput() {
    const form = formRef.current
    if (!form) return
    const hidden = form.querySelector<HTMLInputElement>('input[name="config"]')
    if (!hidden) return
    try {
      const next = JSON.parse(hidden.value) as Record<string, unknown>
      setLiveConfig(next)
    } catch {
      // editor mid-edit
    }
  }

  function markCompleted(i: number) {
    setCompleted((prev) => (prev.includes(i) ? prev : [...prev, i]))
  }

  const draftPage: ActionPageRow = {
    ...page,
    title,
    description: description || null,
    slug,
    status,
    config: liveConfig,
  }

  const prevStep = step > 0 ? STEPS[step - 1] : null
  const nextStep = step < STEPS.length - 1 ? STEPS[step + 1] : null
  const statusLabel =
    status === 'draft' ? 'Draft' : status === 'published' ? 'Live' : 'Archived'

  return (
    <div data-actions-root>
      <div className="ap-page">
        <div className="ap-topbar">
          <Link href="/dashboard/action-pages" className="ap-back">
            <Chevron dir="left" /> Back
          </Link>
          <div className="ap-crumbs">
            <Link href="/dashboard/action-pages">Action Pages</Link>
            <Chevron dir="right" size={12} />
            <span className="ap-crumb-current">{title || page.title}</span>
          </div>
          <div className="ap-spacer" />
          <span
            className={`ap-status-pill${status === 'published' ? ' live' : ''}`}
          >
            <span className="ap-status-dot" />
            {statusLabel}
          </span>
          <Link
            href={`/dashboard/action-pages/${page.id}/submissions`}
            className="ap-btn ap-btn-primary ap-btn-sm"
          >
            <EyeIcon /> Submissions
          </Link>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="ap-btn ap-btn-ghost ap-btn-sm"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>

        <div className="ap-head">
          <div className="ap-head-meta">
            <h1>{title || page.title || 'Untitled'}</h1>
            <p className="ap-sub">
              {meta.label} · {meta.blurb}
            </p>
          </div>
        </div>

        {saved && <div className="ap-banner success">Saved.</div>}
        {errorBanner && <div className="ap-banner error">{errorBanner}</div>}

        <Stepper current={step} setCurrent={setStep} completed={completed} />

        <div className={`ap-content${showPreview ? ' with-preview' : ''}`}>
          <div className="ap-editor">
            <form
              ref={formRef}
              action={updateActionPage}
              onInput={handleFormInput}
            >
              <input type="hidden" name="id" value={page.id} />
              <input type="hidden" name="title" value={title} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="description" value={description} />
              <input type="hidden" name="status" value={status} />

              <Panel active={step === 0}>
                <GeneralStep
                  title={title}
                  description={description}
                  slug={slug}
                  status={status}
                  onTitle={setTitle}
                  onDescription={setDescription}
                  onSlug={setSlug}
                  onStatus={setStatus}
                />
              </Panel>

              <Panel active={step === 1}>
                <Tips icon="palette">
                  <b>Edit what&apos;s shown on the public page.</b>
                  <br />
                  Match your brand with the accent color, then set when slots
                  are bookable.
                </Tips>
                <div className="ap-section">
                  <div className="ap-section-head">
                    <h2>{meta.label} configuration</h2>
                    <p>The fields below control the live public page.</p>
                  </div>
                  <div className="ap-section-body">
                    <KindEditor page={page} />
                  </div>
                </div>
              </Panel>

              <Panel active={step === 2}>
                <Tips icon="workflow">
                  <b>
                    Pipeline rules choose which stage a lead lands in for each
                    outcome.
                  </b>
                  <br />
                  Leave the stage empty to record the outcome without moving
                  the lead.
                </Tips>

                <div className="ap-section">
                  <div className="ap-section-head">
                    <h2>Pipeline rules</h2>
                    <p>
                      When a submission resolves to an outcome, move the lead
                      and (optionally) send a Messenger reply.
                    </p>
                  </div>
                  <div className="ap-section-body">
                    <PipelineRulesEditor
                      initial={page.pipeline_rules}
                      stages={stages}
                    />
                  </div>
                </div>

                <div className="ap-section">
                  <div className="ap-section-head">
                    <h2>Messenger echo</h2>
                    <p>
                      Plain-text confirmation sent back in Messenger after a
                      successful submission. Leave empty to skip.
                    </p>
                  </div>
                  <div className="ap-section-body">
                    <textarea
                      name="notification_text"
                      defaultValue={page.notification_template?.text ?? ''}
                      rows={3}
                      maxLength={640}
                      placeholder="Thanks! We got your details and will be in touch shortly."
                      className="ap-textarea"
                    />
                  </div>
                </div>

                <div className="ap-section">
                  <div className="ap-section-head">
                    <h2>Messenger send</h2>
                    <p>
                      Let the bot send this page to a Messenger lead as a button
                      when it matches your instructions.
                    </p>
                  </div>
                  <div className="ap-section-body">
                    <CtaField defaultValue={page.cta_label ?? ''} />
                    <Field
                      label="When should the bot send this?"
                      help="Plain-language guidance. Bot picks at most one action page per reply, so be specific."
                    >
                      <textarea
                        name="bot_send_instructions"
                        defaultValue={page.bot_send_instructions ?? ''}
                        rows={4}
                        maxLength={2000}
                        placeholder="Send when the lead asks about pricing, wants a quote, or asks to book a demo."
                        className="ap-textarea"
                      />
                    </Field>
                  </div>
                </div>
              </Panel>

              <Panel active={step === 3}>
                <Tips icon="share">
                  <b>Send leads here or embed the page on your own site.</b>
                  <br />
                  The embed snippet works on any site that allows iframes.
                </Tips>

                <div className="ap-section">
                  <div className="ap-section-head">
                    <h2>Links</h2>
                    <p>Share these directly or paste them into a campaign.</p>
                  </div>
                  <div className="ap-section-body">
                    <Field label="Public URL">
                      <CopyField value={publicUrl} label="Public URL" />
                    </Field>
                    {meta.supportsEmbed && (
                      <Field label="Embed URL">
                        <CopyField value={embedUrl} label="Embed URL" />
                      </Field>
                    )}
                  </div>
                </div>

                {meta.supportsEmbed && (
                  <div className="ap-section">
                    <div className="ap-section-head">
                      <h2>Embed snippet</h2>
                      <p>
                        Drop this iframe wherever you want the flow to appear.
                      </p>
                    </div>
                    <div className="ap-section-body">
                      <CopyField value={embedSnippet} label="Embed snippet" />
                    </div>
                  </div>
                )}
              </Panel>

              <div className="ap-save-bar">
                <div className="ap-save-meta">
                  <b>Step {step + 1} of {STEPS.length}</b>
                  <span style={{ opacity: 0.7 }}>
                    {' '}
                    · {STEPS[step].label}
                  </span>
                </div>
                <button
                  type="button"
                  className="ap-btn ap-btn-ghost"
                  onClick={() => prevStep && setStep(step - 1)}
                  disabled={!prevStep}
                >
                  <Chevron dir="left" />
                  {prevStep ? prevStep.label : 'Back'}
                </button>
                <SaveButton onSaved={() => markCompleted(step)} />
                {nextStep && (
                  <button
                    type="button"
                    className="ap-btn ap-btn-primary"
                    onClick={() => {
                      markCompleted(step)
                      setStep(step + 1)
                    }}
                  >
                    Next: {nextStep.label} <Chevron dir="right" />
                  </button>
                )}
              </div>
            </form>

            <DangerZone id={page.id} />
          </div>

          {showPreview && (
            <div>
              <ActionPagePreview
                kind={page.kind}
                title={title}
                description={description}
                slug={slug}
                accent={accent}
                status={status}
                config={liveConfig}
                realPage={draftPage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({
  current,
  setCurrent,
  completed,
}: {
  current: number
  setCurrent: (i: number) => void
  completed: number[]
}) {
  return (
    <div className="ap-stepper" role="tablist">
      {STEPS.map((s, i) => {
        const state = completed.includes(i)
          ? current === i
            ? 'active'
            : 'done'
          : current === i
            ? 'active'
            : ''
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={current === i}
            onClick={() => setCurrent(i)}
            className={`ap-step ${state}`}
          >
            <div className="ap-step-num">
              {completed.includes(i) && current !== i ? (
                <CheckIcon size={12} />
              ) : (
                i + 1
              )}
            </div>
            <div>
              <div className="ap-step-label">{s.label}</div>
              <div className="ap-step-sub">{s.sub}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Panel({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? '' : 'hidden'}>{children}</div>
}

function Tips({ children, icon }: { children: ReactNode; icon: 'palette' | 'workflow' | 'share' | 'sparkle' }) {
  return (
    <div className="ap-tips">
      <div className="ap-tips-icon">
        <TipsIcon name={icon} />
      </div>
      <div className="ap-tips-body">{children}</div>
    </div>
  )
}

function Field({
  label,
  optional,
  help,
  helpMono,
  children,
}: {
  label?: string
  optional?: boolean
  help?: string
  helpMono?: boolean
  children: ReactNode
}) {
  return (
    <div className="ap-field">
      {label && (
        <div className="ap-field-label">
          {label}
          {optional && <span className="ap-opt">Optional</span>}
        </div>
      )}
      {children}
      {help && (
        <div className={`ap-field-help${helpMono ? ' mono' : ''}`}>{help}</div>
      )}
    </div>
  )
}

function GeneralStep({
  title,
  description,
  slug,
  status,
  onTitle,
  onDescription,
  onSlug,
  onStatus,
}: {
  title: string
  description: string
  slug: string
  status: ActionPageRow['status']
  onTitle: (v: string) => void
  onDescription: (v: string) => void
  onSlug: (v: string) => void
  onStatus: (v: ActionPageRow['status']) => void
}) {
  return (
    <>
      <Tips icon="sparkle">
        <b>This is the public face of your page.</b>
        <br />
        Title and description are what leads see first — keep it short and
        outcome-focused.
      </Tips>

      <div className="ap-section">
        <div className="ap-section-head">
          <h2>Basics</h2>
          <p>Basic info shown to leads on the public page.</p>
        </div>
        <div className="ap-section-body">
          <Field label="Title">
            <input
              className="ap-input"
              value={title}
              onChange={(e) => onTitle(e.target.value.slice(0, 120))}
              maxLength={120}
              required
              placeholder="e.g. 30-min discovery call"
            />
          </Field>
          <Field
            label="Description"
            optional
            help="One or two sentences. Markdown supported."
          >
            <textarea
              className="ap-textarea"
              value={description}
              onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
              maxLength={2000}
              placeholder="Tell leads what to expect."
            />
          </Field>
        </div>
      </div>

      <div className="ap-section">
        <div className="ap-section-head">
          <h2>Address &amp; visibility</h2>
          <p>Control where this page lives and who can see it.</p>
        </div>
        <div className="ap-section-body">
          <Field
            label="Slug"
            helpMono
            help={`Public URL: /a/${slug}`}
          >
            <div className="ap-input-affix">
              <span className="ap-prefix">/a/</span>
              <input
                value={slug}
                onChange={(e) =>
                  onSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '-')
                      .replace(/^-+/, ''),
                  )
                }
                pattern="[a-z0-9][-a-z0-9]*"
                required
              />
            </div>
          </Field>
          <Field
            label="Status"
            help={
              status === 'draft'
                ? 'Not visible to the public yet.'
                : status === 'published'
                  ? 'Live and accepting submissions.'
                  : 'Hidden from everyone.'
            }
          >
            <div className="ap-status-segment">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={`ap-seg-btn${status === o.v ? ' active' : ''}`}
                  onClick={() => onStatus(o.v)}
                >
                  <span
                    className={`ap-seg-dot ${
                      o.v === 'draft'
                        ? 'draft'
                        : o.v === 'published'
                          ? 'live'
                          : 'archived'
                    }`}
                  />
                  {o.l}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
    </>
  )
}

function CtaField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Field
      label="Button label (CTA)"
      help={`Up to 50 characters. Leave empty to disable autonomous sending. (${value.length}/50)`}
    >
      <input
        name="cta_label"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={50}
        placeholder="Book a demo"
        className="ap-input"
      />
    </Field>
  )
}

function SaveButton({ onSaved }: { onSaved?: () => void }) {
  const { pending } = useFormStatus()
  // useFormStatus reflects pending state from the surrounding <form>; we mark the step completed when click fires.
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={() => onSaved?.()}
      className="ap-btn ap-btn-primary"
    >
      {pending ? 'Saving…' : 'Save changes'}
    </button>
  )
}

function DangerZone({ id }: { id: string }) {
  return (
    <div className="ap-danger">
      <div className="ap-danger-meta">
        <h3>Danger zone</h3>
        <p>
          Deleting an action page is permanent and removes its public URL. Past
          submissions are kept on the lead records.
        </p>
      </div>
      <form action={deleteActionPage}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="ap-btn ap-btn-danger-ghost ap-btn-sm">
          Delete page
        </button>
      </form>
    </div>
  )
}

/* ---------- Tiny inline icons ---------- */

function Chevron({
  dir,
  size = 14,
}: {
  dir: 'left' | 'right'
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === 'left' ? (
        <polyline points="15 6 9 12 15 18" />
      ) : (
        <polyline points="9 6 15 12 9 18" />
      )}
    </svg>
  )
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function TipsIcon({ name }: { name: 'palette' | 'workflow' | 'share' | 'sparkle' }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (name === 'palette') {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M12 3a9 9 0 100 18c1 0 1.5-.5 1.5-1.3 0-.4-.2-.7-.5-1-.3-.3-.5-.6-.5-1 0-.8.6-1.3 1.5-1.3H16a5 5 0 005-5 7.7 7.7 0 00-9-8.4z" />
        <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
        <circle cx="12" cy="7.5" r="1" fill="currentColor" />
        <circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
      </svg>
    )
  }
  if (name === 'workflow') {
    return (
      <svg {...props} aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" rx="1.5" />
        <rect x="15" y="15" width="6" height="6" rx="1.5" />
        <rect x="15" y="3" width="6" height="6" rx="1.5" />
        <path d="M9 6h6M18 9v6" />
      </svg>
    )
  }
  if (name === 'share') {
    return (
      <svg {...props} aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
    )
  }
  return (
    <svg {...props} aria-hidden="true">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z" />
    </svg>
  )
}

export type { PipelineRule }
