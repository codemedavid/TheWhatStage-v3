'use client'

import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useFormStatus } from 'react-dom'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import type {
  ActionPageOption,
  ActionPageRow,
  PipelineStageOption,
} from '../_lib/queries'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import { updateActionPage, deleteActionPage } from '../actions/crud'
import { BookingStudioPreview } from './BookingStudioPreview'
import { CopyField } from './CopyField'
import { PipelineRulesEditor } from './PipelineRulesEditor'
import { TriggerGuard } from './TriggerGuard'
import { TriggerField } from './TriggerField'
import { DraftSaveModal } from './DraftSaveModal'
import { useDraftGate } from './useDraftGate'
import { BookingThanksComposer } from './BookingThanksComposer'
import { FollowupTouchpointsEditor } from '../_kinds/booking/FollowupTouchpointsEditor'
import { extractCustomKeysFromConfig } from '../_lib/custom-keys'
import {
  defaultBookingConfig,
  parseBookingConfig,
  type BookingConfig,
  type BookingDay,
  type BookingFormField,
} from '@/app/a/[slug]/_kinds/booking/schema'

type BlockId =
  | 'header'
  | 'schedule'
  | 'form'
  | 'cta'
  | 'thanks'
  | 'pipeline'
  | 'followups'
  | 'tracking'
  | 'share'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const CAPI_EVENT_OPTIONS = [
  'LeadSubmitted',
  'QualifiedLead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'CartAbandoned',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'RatingProvided',
  'ReviewProvided',
  'SKIP',
] as const

const FIELD_KIND_OPTIONS: Array<{ value: BookingFormField['field_kind']; label: string }> = [
  { value: 'short_text', label: 'Short text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
]

function genFieldId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function fillAvailability(cfg: BookingConfig): BookingConfig {
  if (cfg.availability.length === 7) return cfg
  return { ...cfg, availability: defaultBookingConfig().availability }
}

export function BookingStudioShell({
  page,
  stages,
  publicUrl,
  embedUrl,
  embedSnippet,
  saved,
  errorBanner,
}: {
  page: ActionPageRow
  stages: PipelineStageOption[]
  actionPages?: ActionPageOption[]
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  saved: boolean
  errorBanner: string | null
  paymentMethods?: PaymentMethod[]
}) {
  const meta = KIND_REGISTRY[page.kind]

  const initialBooking = useMemo<BookingConfig>(
    () => fillAvailability(parseBookingConfig(page.config)),
    [page.config],
  )

  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description ?? '')
  const [slug, setSlug] = useState(page.slug)
  const [status, setStatus] = useState<ActionPageRow['status']>(page.status)
  const [booking, setBooking] = useState<BookingConfig>(initialBooking)
  const [selected, setSelected] = useState<BlockId>('schedule')
  const [mobilePane, setMobilePane] = useState<'tree' | 'preview' | 'inspector'>(
    'tree',
  )

  const formRef = useRef<HTMLFormElement | null>(null)
  const draftGate = useDraftGate({ status, setStatus })

  // Hide the app chrome (sidebar, topbar, main padding) while the booking
  // studio is mounted; restore on unmount.
  useEffect(() => {
    document.body.dataset.bookingStudio = '1'
    return () => {
      delete document.body.dataset.bookingStudio
    }
  }, [])

  // ── booking config helpers ──────────────────────────────────────
  const patchAppointment = (p: Partial<BookingConfig['appointment']>) =>
    setBooking((c) => ({ ...c, appointment: { ...c.appointment, ...p } }))
  const patchTheme = (p: Partial<BookingConfig['theme']>) =>
    setBooking((c) => ({ ...c, theme: { ...c.theme, ...p } }))
  const patchDateRange = (p: Partial<BookingConfig['date_range']>) =>
    setBooking((c) => ({ ...c, date_range: { ...c.date_range, ...p } }))
  const setSlotsPerWindow = (n: number) =>
    setBooking((c) => ({ ...c, slots_per_window: Math.max(1, Math.min(50, n || 1)) }))
  const patchDay = (weekday: number, patch: Partial<BookingDay>) =>
    setBooking((c) => ({
      ...c,
      availability: c.availability.map((d) =>
        d.weekday === weekday ? { ...d, ...patch } : d,
      ),
    }))
  const addWindow = (weekday: number) => {
    const day = booking.availability.find((d) => d.weekday === weekday)
    patchDay(weekday, {
      enabled: true,
      windows: [...(day?.windows ?? []), { start: '09:00', end: '17:00' }],
    })
  }
  const removeWindow = (weekday: number, idx: number) => {
    const day = booking.availability.find((d) => d.weekday === weekday)
    if (!day) return
    patchDay(weekday, { windows: day.windows.filter((_, i) => i !== idx) })
  }
  const updateWindow = (
    weekday: number,
    idx: number,
    patch: Partial<{ start: string; end: string }>,
  ) => {
    const day = booking.availability.find((d) => d.weekday === weekday)
    if (!day) return
    patchDay(weekday, {
      windows: day.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    })
  }
  const addField = () =>
    setBooking((c) => ({
      ...c,
      form: {
        ...c.form,
        fields: [
          ...c.form.fields,
          {
            id: genFieldId(),
            key: `field_${c.form.fields.length + 1}`,
            label: 'New field',
            field_kind: 'short_text',
            required: false,
          },
        ],
      },
    }))
  const updateField = (id: string, patch: Partial<BookingFormField>) =>
    setBooking((c) => ({
      ...c,
      form: {
        ...c.form,
        fields: c.form.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      },
    }))
  const removeField = (id: string) =>
    setBooking((c) => ({
      ...c,
      form: { ...c.form, fields: c.form.fields.filter((f) => f.id !== id) },
    }))

  // ── derived ─────────────────────────────────────────────────────
  const accent = booking.theme.accent_color
  const enabledDayCount = booking.availability.filter((d) => d.enabled).length
  const requiredCount = booking.form.fields.filter((f) => f.required).length

  const blocks: { id: BlockId; label: string; sub: string; icon: IconName }[] = [
    { id: 'header', label: 'Header', sub: `"${title || 'Untitled'}"`, icon: 'image' },
    {
      id: 'schedule',
      label: 'Availability',
      sub: `${booking.appointment.duration_min}m · ${enabledDayCount} day${enabledDayCount === 1 ? '' : 's'}/wk`,
      icon: 'cal',
    },
    {
      id: 'form',
      label: 'Form fields',
      sub: `${booking.form.fields.length} field${booking.form.fields.length === 1 ? '' : 's'}${requiredCount ? ` · ${requiredCount} required` : ''}`,
      icon: 'form',
    },
    { id: 'cta', label: 'Booking CTA', sub: page.cta_label || '—', icon: 'bolt' },
    { id: 'thanks', label: 'Thank-you', sub: 'After booking', icon: 'check' },
  ]
  const opsBlocks: { id: BlockId; label: string; sub: string; icon: IconName }[] = [
    { id: 'pipeline', label: 'Pipeline', sub: `${page.pipeline_rules.length} rule${page.pipeline_rules.length === 1 ? '' : 's'}`, icon: 'pipeline' },
    { id: 'followups', label: 'Follow-ups', sub: 'Messenger sequence', icon: 'message' },
    { id: 'tracking', label: 'Tracking', sub: page.capi_event_name_override ?? 'Default CAPI', icon: 'target' },
    { id: 'share', label: 'Share & embed', sub: slug, icon: 'share' },
  ]

  const onSelect = (id: BlockId) => {
    setSelected(id)
    setMobilePane('inspector')
  }

  return (
    <div data-booking-studio>
      <BookingStudioStyles />
      <form ref={formRef} action={updateActionPage} className="bs-form">
        {/* hidden inputs the server action reads */}
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="config" value={JSON.stringify(booking)} />

        {/* ─── TOP BAR ───────────────────────────────────────── */}
        <header className="bs-topbar">
          <TriggerGuard
            pageId={page.id}
            initialTrigger={page.bot_send_instructions}
            backHref="/dashboard/action-pages"
            className="bs-back"
            onJumpToTrigger={() => setSelected('cta')}
          >
            <Icon name="chevLeft" size={14} /> Back
          </TriggerGuard>
          <span className="bs-sep">/</span>
          <div className="bs-crumbs">
            <span className="bs-crumb-muted">Action pages</span>
            <Icon name="chevRight" size={11} />
            <span className="bs-crumb-cur">{title || page.title || 'Untitled'}</span>
            <span className={`bs-pill ${status === 'published' ? 'live' : status === 'draft' ? 'draft' : ''}`}>
              <span className="bs-pill-dot" />
              {status === 'published' ? 'Live' : status === 'draft' ? 'Draft' : 'Archived'}
            </span>
          </div>
          <div className="bs-spacer" />
          <Link
            href={`/dashboard/action-pages/${page.id}/submissions`}
            className="bs-btn bs-btn-ghost"
          >
            <Icon name="eye" size={13} /> Submissions
          </Link>
          <SaveButton onClick={(e) => draftGate.requestSave(e.currentTarget.form)} />
        </header>

        {saved && <div className="bs-banner success">Saved.</div>}
        {errorBanner && <div className="bs-banner error">{errorBanner}</div>}

        {/* ─── MOBILE PANE TABS ──────────────────────────────── */}
        <div className="bs-mobile-tabs">
          {(['tree', 'preview', 'inspector'] as const).map((p) => (
            <button
              type="button"
              key={p}
              className={`bs-mobile-tab ${mobilePane === p ? 'active' : ''}`}
              onClick={() => setMobilePane(p)}
            >
              {p === 'tree' ? 'Blocks' : p === 'preview' ? 'Preview' : 'Inspector'}
            </button>
          ))}
        </div>

        {/* ─── 3 PANES ───────────────────────────────────────── */}
        <div className="bs-shell">
          {/* LEFT */}
          <aside className={`bs-pane bs-left ${mobilePane === 'tree' ? 'mobile-active' : ''}`}>
            {/* Bot trigger card — hoisted */}
            <div className="bs-section bs-trigger">
              <div className="bs-seclabel">
                <span><Icon name="bot" size={11} /> Bot trigger</span>
                <span className="bs-pill accent"><Icon name="sparkle" size={9} /> AI</span>
              </div>
              <div className="bs-trigger-box">
                <div className="bs-trigger-help">Send this page when…</div>
                <TriggerField
                  initial={page.bot_send_instructions ?? ''}
                  defaultText={meta.defaultBotSendInstructions}
                  rows={3}
                  placeholder="Send when the lead asks about pricing, wants a quote, or asks to book."
                  className="bs-trigger-textarea"
                />
              </div>
            </div>

            {/* Blocks */}
            <div className="bs-section bs-blocks">
              <div className="bs-seclabel">
                <span><Icon name="layers" size={11} /> Page blocks</span>
              </div>
              <div className="bs-rows">
                {blocks.map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>

              <div className="bs-seclabel mt">
                <span><Icon name="sliders" size={11} /> After booking</span>
              </div>
              <div className="bs-rows">
                {opsBlocks.map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>
            </div>

            <div className="bs-leftfoot">
              <div className="bs-leftfoot-row">
                <span>Public URL</span>
                <span className="mono">/a/{slug}</span>
              </div>
            </div>
          </aside>

          {/* CENTER */}
          <main className={`bs-pane bs-center ${mobilePane === 'preview' ? 'mobile-active' : ''}`}>
            <div className="bs-canvas-toolbar">
              <Icon name="eye" size={12} />
              <span>Live preview · what a lead sees at /a/{slug}</span>
              <div className="bs-spacer" />
              <span className="bs-mute">Click a block on the left to edit it</span>
            </div>
            <div className="bs-canvas-full">
              <BookingStudioPreview
                title={title}
                description={description}
                slug={slug}
                config={booking}
              />
            </div>
          </main>

          {/* RIGHT — every inspector is mounted so its hidden inputs always
              submit with the form. We hide the non-selected ones with CSS. */}
          <aside className={`bs-pane bs-right ${mobilePane === 'inspector' ? 'mobile-active' : ''}`}>
            <InspectorSlot active={selected === 'header'}>
              <InspectorHeader
                title={title}
                description={description}
                onTitle={setTitle}
                onDescription={setDescription}
                slug={slug}
                onSlug={setSlug}
                status={status}
                onStatus={setStatus}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'schedule'}>
              <InspectorAvailability
                booking={booking}
                patchAppointment={patchAppointment}
                patchDay={patchDay}
                addWindow={addWindow}
                removeWindow={removeWindow}
                updateWindow={updateWindow}
                patchDateRange={patchDateRange}
                setSlotsPerWindow={setSlotsPerWindow}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'form'}>
              <InspectorForm
                fields={booking.form.fields}
                addField={addField}
                updateField={updateField}
                removeField={removeField}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'cta'}>
              <InspectorCta
                accent={accent}
                onAccent={(v) => patchTheme({ accent_color: v })}
                buttonText={booking.theme.button_text_color}
                onButtonText={(v) => patchTheme({ button_text_color: v })}
                background={booking.theme.background_color}
                onBackground={(v) => patchTheme({ background_color: v })}
                ctaLabelInitial={page.cta_label ?? ''}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'thanks'}>
              <InspectorThanks kind={page.kind} page={page} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'pipeline'}>
              <InspectorPipeline page={page} stages={stages} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'followups'}>
              <InspectorFollowups pageId={page.id} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'tracking'}>
              <InspectorTracking
                defaultValue={page.capi_event_name_override ?? ''}
                kind={page.kind}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'share'}>
              <InspectorShare
                publicUrl={publicUrl}
                embedUrl={embedUrl}
                embedSnippet={embedSnippet}
                supportsEmbed={meta.supportsEmbed}
              />
            </InspectorSlot>
          </aside>
        </div>
      </form>

      {/* Danger zone is its own form (not nested in the editor form). */}
      <DangerZone id={page.id} />

      <DraftSaveModal {...draftGate.modalProps} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Save button
// ─────────────────────────────────────────────────────────────────────────

function SaveButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="bs-btn bs-btn-primary"
    >
      {pending ? 'Saving…' : 'Save changes'}
      {!pending && <Icon name="arrowRight" size={12} />}
    </button>
  )
}

function DangerZone({ id }: { id: string }) {
  return (
    <form action={deleteActionPage} className="bs-danger">
      <input type="hidden" name="id" value={id} />
      <div>
        <h3>Danger zone</h3>
        <p>Deleting an action page is permanent. Past submissions are kept on the lead records.</p>
      </div>
      <button
        type="submit"
        className="bs-btn bs-btn-danger"
        onClick={(e) => {
          if (!confirm('Delete this action page? This cannot be undone.')) {
            e.preventDefault()
          }
        }}
      >
        Delete page
      </button>
    </form>
  )
}

function InspectorSlot({ active, children }: { active: boolean; children: ReactNode }) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>
}

// ─────────────────────────────────────────────────────────────────────────
// Block row
// ─────────────────────────────────────────────────────────────────────────

function BlockRow({
  block,
  selected,
  onClick,
}: {
  block: { id: BlockId; label: string; sub: string; icon: IconName }
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`bs-row ${selected ? 'sel' : ''}`}
      onClick={onClick}
    >
      <span className="bs-row-rail" aria-hidden />
      <Icon name="grip" size={11} color="var(--bs-ink-5)" />
      <Icon name={block.icon} size={13} color={selected ? 'var(--bs-accent-2)' : 'var(--bs-ink-3)'} />
      <span className="bs-row-meta">
        <span className="bs-row-label">{block.label}</span>
        <span className="bs-row-sub">{block.sub}</span>
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector chrome
// ─────────────────────────────────────────────────────────────────────────

function InspectorHead({
  icon,
  title,
  sub,
}: {
  icon: IconName
  title: string
  sub: string
}) {
  return (
    <div className="bs-insphead">
      <div className="bs-insphead-icon"><Icon name={icon} size={15} /></div>
      <div>
        <div className="bs-insphead-title">{title}</div>
        <div className="bs-insphead-sub">{sub}</div>
      </div>
    </div>
  )
}

function InspGroup({
  label,
  children,
  action,
}: {
  label?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="bs-group">
      {label && (
        <div className="bs-seclabel">
          <span>{label}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="bs-field">
      <span className="bs-field-label">{label}</span>
      {children}
      {hint && <span className="bs-field-hint">{hint}</span>}
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Header (basics)
// ─────────────────────────────────────────────────────────────────────────

function InspectorHeader({
  title,
  description,
  onTitle,
  onDescription,
  slug,
  onSlug,
  status,
  onStatus,
}: {
  title: string
  description: string
  onTitle: (v: string) => void
  onDescription: (v: string) => void
  slug: string
  onSlug: (v: string) => void
  status: ActionPageRow['status']
  onStatus: (v: ActionPageRow['status']) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="image" title="Header" sub="The top of the public page" />
      <InspGroup label="Title">
        <input
          className="bs-input"
          value={title}
          onChange={(e) => onTitle(e.target.value.slice(0, 120))}
          maxLength={120}
          placeholder="e.g. 30-min discovery call"
        />
      </InspGroup>
      <InspGroup label="Description">
        <textarea
          className="bs-textarea"
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
          rows={4}
          placeholder="One or two sentences leads see first."
        />
      </InspGroup>
      <InspGroup label="Slug">
        <div className="bs-input-affix">
          <span className="bs-prefix">/a/</span>
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
          />
        </div>
      </InspGroup>
      <InspGroup label="Status">
        <div className="bs-segment">
          {(
            [
              { v: 'draft', l: 'Draft' },
              { v: 'published', l: 'Live' },
              { v: 'archived', l: 'Archived' },
            ] as { v: ActionPageRow['status']; l: string }[]
          ).map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => onStatus(o.v)}
              className={`bs-segbtn ${status === o.v ? 'on' : ''}`}
            >
              <span className={`bs-dot ${o.v}`} />
              {o.l}
            </button>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Availability — the hero inspector
// ─────────────────────────────────────────────────────────────────────────

function InspectorAvailability({
  booking,
  patchAppointment,
  patchDay,
  addWindow,
  removeWindow,
  updateWindow,
  patchDateRange,
  setSlotsPerWindow,
}: {
  booking: BookingConfig
  patchAppointment: (p: Partial<BookingConfig['appointment']>) => void
  patchDay: (weekday: number, patch: Partial<BookingDay>) => void
  addWindow: (weekday: number) => void
  removeWindow: (weekday: number, idx: number) => void
  updateWindow: (
    weekday: number,
    idx: number,
    patch: Partial<{ start: string; end: string }>,
  ) => void
  patchDateRange: (p: Partial<BookingConfig['date_range']>) => void
  setSlotsPerWindow: (n: number) => void
}) {
  const enabledCount = booking.availability.filter((d) => d.enabled).length
  return (
    <div className="bs-insp">
      <InspectorHead icon="cal" title="Availability" sub="When can leads book?" />

      <InspGroup label={<><Icon name="clock" size={11} /> Slot shape</>}>
        <Field label="Slot length">
          <div className="bs-segment">
            {[15, 30, 45, 60, 90].map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => patchAppointment({ duration_min: n })}
                className={`bs-segbtn ${booking.appointment.duration_min === n ? 'on' : ''}`}
              >
                {n}m
              </button>
            ))}
          </div>
        </Field>
        <Field label="Buffer after">
          <div className="bs-input-suffix">
            <input
              type="number"
              min={0}
              max={120}
              value={booking.appointment.buffer_min}
              onChange={(e) =>
                patchAppointment({ buffer_min: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })
              }
            />
            <span>min</span>
          </div>
        </Field>
        <Field label="Time zone">
          <input
            className="bs-input"
            value={booking.appointment.timezone}
            onChange={(e) => patchAppointment({ timezone: e.target.value })}
            placeholder="Asia/Manila"
          />
        </Field>
      </InspGroup>

      <InspGroup label={<><Icon name="cal" size={11} /> Weekly schedule</>}>
        <div className="bs-week">
          {booking.availability.map((d) => (
            <div key={d.weekday} className={`bs-day ${d.enabled ? '' : 'off'}`}>
              <button
                type="button"
                className="bs-day-label"
                onClick={() => patchDay(d.weekday, { enabled: !d.enabled })}
              >
                {WEEKDAY_LABELS[d.weekday]}
              </button>
              <div className="bs-day-windows">
                {!d.enabled && <span className="bs-empty">Unavailable</span>}
                {d.enabled && d.windows.length === 0 && (
                  <span className="bs-empty">Add hours…</span>
                )}
                {d.enabled &&
                  d.windows.map((w, i) => (
                    <span className="bs-window" key={i}>
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) => updateWindow(d.weekday, i, { start: e.target.value })}
                      />
                      <span>–</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) => updateWindow(d.weekday, i, { end: e.target.value })}
                      />
                      <button
                        type="button"
                        className="bs-window-x"
                        onClick={() => removeWindow(d.weekday, i)}
                        aria-label="Remove window"
                      >
                        <Icon name="x" size={9} />
                      </button>
                    </span>
                  ))}
                <button
                  type="button"
                  className="bs-add-window"
                  onClick={() => addWindow(d.weekday)}
                  aria-label={d.enabled ? 'Add hours' : `Enable ${WEEKDAY_LABELS[d.weekday]} and add hours`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </InspGroup>

      <InspGroup label={<><Icon name="settings" size={11} /> Booking window</>}>
        <Field label="Open from">
          <input
            type="date"
            className="bs-input"
            value={booking.date_range.from ?? ''}
            onChange={(e) => patchDateRange({ from: e.target.value || null })}
          />
        </Field>
        <Field label="Open to" hint="Leave blank for no boundary.">
          <input
            type="date"
            className="bs-input"
            value={booking.date_range.to ?? ''}
            onChange={(e) => patchDateRange({ to: e.target.value || null })}
          />
        </Field>
        <Field label="Slots per start time">
          <div className="bs-input-suffix">
            <input
              type="number"
              min={1}
              max={50}
              value={booking.slots_per_window}
              onChange={(e) => setSlotsPerWindow(Number(e.target.value))}
            />
            <span>bookings</span>
          </div>
        </Field>
      </InspGroup>

      <div className="bs-callout">
        <Icon name="sparkle" size={13} />
        <span>
          <b>Looks healthy.</b> {enabledCount} active day{enabledCount === 1 ? '' : 's'} ·{' '}
          {booking.appointment.duration_min}-minute slots.
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Form fields
// ─────────────────────────────────────────────────────────────────────────

function InspectorForm({
  fields,
  addField,
  updateField,
  removeField,
}: {
  fields: BookingFormField[]
  addField: () => void
  updateField: (id: string, patch: Partial<BookingFormField>) => void
  removeField: (id: string) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="form" title="Form fields" sub="What the lead fills out" />
      <InspGroup
        label={<><Icon name="list" size={11} /> Fields</>}
        action={
          <button type="button" className="bs-link" onClick={addField}>
            <Icon name="plus" size={11} /> Add field
          </button>
        }
      >
        <div className="bs-rows">
          {fields.length === 0 && (
            <div className="bs-empty-state">
              <Icon name="form" size={18} />
              <div>No fields yet</div>
              <button type="button" className="bs-btn bs-btn-ghost sm" onClick={addField}>
                <Icon name="plus" size={11} /> Add first field
              </button>
            </div>
          )}
          {fields.map((f) => (
            <div className="bs-fieldcard" key={f.id}>
              <div className="bs-fieldcard-row">
                <input
                  className="bs-input sm"
                  value={f.label}
                  placeholder="Label"
                  onChange={(e) => updateField(f.id, { label: e.target.value.slice(0, 120) })}
                />
                <select
                  className="bs-select sm"
                  value={f.field_kind}
                  onChange={(e) =>
                    updateField(f.id, {
                      field_kind: e.target.value as BookingFormField['field_kind'],
                    })
                  }
                >
                  {FIELD_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="bs-fieldcard-row">
                <input
                  className="bs-input sm mono"
                  value={f.key}
                  placeholder="field_key"
                  onChange={(e) =>
                    updateField(f.id, {
                      key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    })
                  }
                />
                <label className="bs-check">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(f.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  className="bs-iconbtn danger"
                  onClick={() => removeField(f.id)}
                  aria-label="Remove field"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Booking CTA / theme
// ─────────────────────────────────────────────────────────────────────────

function InspectorCta({
  accent,
  onAccent,
  buttonText,
  onButtonText,
  background,
  onBackground,
  ctaLabelInitial,
}: {
  accent: string
  onAccent: (v: string) => void
  buttonText: string
  onButtonText: (v: string) => void
  background: string
  onBackground: (v: string) => void
  ctaLabelInitial: string
}) {
  const [cta, setCta] = useState(ctaLabelInitial)
  const swatches = ['#c96442', '#059669', '#3a5a8c', '#1a1a1a', '#b8860b']
  return (
    <div className="bs-insp">
      <InspectorHead icon="bolt" title="Booking CTA" sub="The primary button + theme" />
      <InspGroup label="Messenger button label">
        <input
          name="cta_label"
          className="bs-input"
          value={cta}
          onChange={(e) => setCta(e.target.value.slice(0, 50))}
          maxLength={50}
          placeholder="Book a demo"
        />
        <span className="bs-field-hint">
          Up to 50 characters. Leave empty to disable autonomous sending. ({cta.length}/50)
        </span>
      </InspGroup>
      <InspGroup label="Accent color">
        <div className="bs-swatches">
          {swatches.map((c) => (
            <button
              type="button"
              key={c}
              className={`bs-swatch ${accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onAccent(c)}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            className="bs-color"
            value={accent}
            onChange={(e) => onAccent(e.target.value)}
          />
        </div>
      </InspGroup>
      <InspGroup label="Button text color">
        <div className="bs-color-row">
          <input
            type="color"
            value={buttonText}
            onChange={(e) => onButtonText(e.target.value)}
          />
          <input
            className="bs-input mono sm"
            value={buttonText}
            onChange={(e) => onButtonText(e.target.value)}
          />
        </div>
      </InspGroup>
      <InspGroup label="Page background">
        <div className="bs-color-row">
          <input
            type="color"
            value={background}
            onChange={(e) => onBackground(e.target.value)}
          />
          <input
            className="bs-input mono sm"
            value={background}
            onChange={(e) => onBackground(e.target.value)}
          />
        </div>
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Thank-you / echo
// ─────────────────────────────────────────────────────────────────────────

function InspectorThanks({
  kind,
  page,
}: {
  kind: ActionPageRow['kind']
  page: ActionPageRow
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="check" title="Thank-you reply" sub="Auto-reply in Messenger after booking" />
      <div className="bs-group">
        <BookingThanksComposer
          name="notification_text"
          kind={kind}
          customKeys={extractCustomKeysFromConfig(kind, page.config)}
          defaultValue={page.notification_template?.text ?? ''}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Pipeline
// ─────────────────────────────────────────────────────────────────────────

function InspectorPipeline({
  page,
  stages,
}: {
  page: ActionPageRow
  stages: PipelineStageOption[]
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="pipeline" title="Pipeline" sub="Move the lead automatically" />
      <InspGroup label={<><Icon name="branch" size={11} /> Stage moves on each outcome</>}>
        <PipelineRulesEditor
          initial={page.pipeline_rules}
          stages={stages}
          kind={page.kind}
        />
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Follow-ups
// ─────────────────────────────────────────────────────────────────────────

function InspectorFollowups({ pageId }: { pageId: string }) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="message" title="Follow-ups" sub="Messenger sequence around the visit" />
      <InspGroup>
        <p className="bs-help">
          Up to 7 utility-template messages fire around the booking time. Approved
          templates only — manage them on the Templates page.
        </p>
        <FollowupTouchpointsEditor pageId={pageId} />
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Tracking
// ─────────────────────────────────────────────────────────────────────────

function InspectorTracking({
  defaultValue,
  kind,
}: {
  defaultValue: string
  kind: ActionPageRow['kind']
}) {
  const defaultLabel =
    kind === 'qualification'
      ? 'QualifiedLead'
      : kind === 'sales' || kind === 'catalog'
        ? 'InitiateCheckout / Purchase'
        : 'LeadSubmitted'
  return (
    <div className="bs-insp">
      <InspectorHead icon="target" title="Tracking" sub="Tell Meta a conversion happened" />
      <InspGroup label="Conversion event">
        <select
          name="capi_event_name_override"
          defaultValue={defaultValue}
          className="bs-select"
        >
          <option value="">Use default ({defaultLabel})</option>
          {CAPI_EVENT_OPTIONS.map((ev) => (
            <option key={ev} value={ev}>
              {ev === 'SKIP' ? "Don't send" : ev}
            </option>
          ))}
        </select>
        <span className="bs-field-hint">
          Which Meta CAPI event fires when a booking is received.
        </span>
      </InspGroup>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inspector: Share
// ─────────────────────────────────────────────────────────────────────────

function InspectorShare({
  publicUrl,
  embedUrl,
  embedSnippet,
  supportsEmbed,
}: {
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  supportsEmbed: boolean
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="share" title="Share & embed" sub="How the page reaches leads" />
      <InspGroup label="Public URL">
        <CopyField value={publicUrl} label="Public URL" />
      </InspGroup>
      {supportsEmbed && (
        <>
          <InspGroup label="Embed URL">
            <CopyField value={embedUrl} label="Embed URL" />
          </InspGroup>
          <InspGroup label="Embed snippet">
            <CopyField value={embedSnippet} label="Embed snippet" />
          </InspGroup>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inline icons (subset of the design's icon set)
// ─────────────────────────────────────────────────────────────────────────

type IconName =
  | 'grip' | 'plus' | 'x' | 'check' | 'chevDown' | 'chevRight' | 'chevLeft'
  | 'arrowRight' | 'eye' | 'settings' | 'sliders' | 'cal' | 'clock' | 'form'
  | 'pipeline' | 'message' | 'target' | 'share' | 'sparkle' | 'bolt' | 'bot'
  | 'layers' | 'list' | 'image' | 'phone' | 'branch'

function Icon({
  name,
  size = 14,
  color = 'currentColor',
}: {
  name: IconName
  size?: number
  color?: string
}) {
  const p: Record<IconName, ReactNode> = {
    grip: (<g><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></g>),
    plus: (<path d="M12 5v14M5 12h14" />),
    x: (<path d="M6 6l12 12M18 6L6 18" />),
    check: (<path d="M5 12.5l4.5 4.5L19 7" />),
    chevDown: (<path d="M6 9l6 6 6-6" />),
    chevRight: (<path d="M9 6l6 6-6 6" />),
    chevLeft: (<path d="M15 6l-6 6 6 6" />),
    arrowRight: (<path d="M5 12h14m-6-6l6 6-6 6" />),
    eye: (<g><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g>),
    settings: (<g><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2L5 6l-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2L10 21h4l.6-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></g>),
    sliders: (<g><path d="M4 8h6M14 8h6M4 16h10M18 16h2" /><circle cx="12" cy="8" r="2" /><circle cx="16" cy="16" r="2" /></g>),
    cal: (<g><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></g>),
    clock: (<g><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g>),
    form: (<g><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></g>),
    pipeline: (<g><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 6h4a4 4 0 014 4v0M8 18h4a4 4 0 004-4v0" /></g>),
    message: (<path d="M21 12a8 8 0 01-12 7l-5 1 1.5-4.5A8 8 0 1121 12z" />),
    target: (<g><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></g>),
    share: (<g><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="M9 11l6-4M9 13l6 4" /></g>),
    sparkle: (<g><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></g>),
    bolt: (<path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />),
    bot: (<g><rect x="4" y="8" width="16" height="12" rx="3" /><circle cx="9" cy="14" r="1.2" /><circle cx="15" cy="14" r="1.2" /><path d="M12 3v5M9 20v2M15 20v2" /></g>),
    layers: (<path d="M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 17l9 5 9-5" />),
    list: (<g><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></g>),
    image: (<g><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M3 17l5-5 4 4 3-3 6 6" /></g>),
    phone: (<path d="M5 4h3l2 5-2 1c1 3 3 5 6 6l1-2 5 2v3a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z" />),
    branch: (<g><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M6 12c0-3.3 2.7-6 6-6h2" /></g>),
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      {p[name]}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Scoped styles
// ─────────────────────────────────────────────────────────────────────────

function BookingStudioStyles() {
  return (
    <style>{`
/* Hide app chrome while booking studio is mounted (body attribute set
   by the shell's useEffect). Scoped to this attribute so it only applies
   on the booking editor route. */
body[data-booking-studio] .ws-sidebar { display: none !important; }
body[data-booking-studio] .ws-topbar { display: none !important; }
body[data-booking-studio] .ws-main { padding: 0 !important; }

[data-booking-studio] {
  --bs-bg:#faf9f5;--bs-bg-2:#f3f0e8;--bs-bg-3:#ebe7da;
  --bs-paper:#fff;--bs-paper-2:#fbfaf5;
  --bs-ink:#1a1a1a;--bs-ink-2:#3d3929;--bs-ink-3:#6e695b;--bs-ink-4:#a59f8e;--bs-ink-5:#c7c1ad;
  --bs-border:#e6e2d6;--bs-border-strong:#d6d0bf;--bs-border-soft:#efece2;
  --bs-accent:#c96442;--bs-accent-2:#b6532f;--bs-accent-soft:#f3e3da;--bs-accent-ghost:#faf0ea;
  --bs-green:#5a8c5e;--bs-green-soft:#e4ede0;--bs-amber:#b8860b;--bs-amber-soft:#f5eed4;
  --bs-danger:#b85450;
  --bs-shadow-1:0 1px 2px rgba(60,50,30,.06);
  --bs-shadow-2:0 1px 3px rgba(60,50,30,.07),0 6px 18px rgba(60,50,30,.06);
  font-family:'Inter',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  color:var(--bs-ink);background:var(--bs-bg);font-size:13px;line-height:1.45;letter-spacing:-.005em;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;min-height:calc(100vh - 32px);
}
[data-booking-studio] * { box-sizing:border-box; }
[data-booking-studio] .bs-form { display:flex; flex-direction:column; flex:1; min-height:0; }
[data-booking-studio] button { font:inherit; color:inherit; cursor:pointer; border:0; background:0; padding:0; }
[data-booking-studio] input, [data-booking-studio] textarea, [data-booking-studio] select { font:inherit; color:inherit; }
[data-booking-studio] .mono { font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace; }

/* ── TOP BAR ─────────────────────────────────────────────── */
[data-booking-studio] .bs-topbar {
  display:flex; align-items:center; gap:10px; height:48px;
  padding:0 14px; background:var(--bs-paper-2);
  border-bottom:1px solid var(--bs-border);
  flex-wrap:wrap;
}
[data-booking-studio] .bs-back {
  display:inline-flex; align-items:center; gap:4px;
  text-decoration:none; color:var(--bs-ink-3); font-weight:500; font-size:12.5px;
  padding:5px 8px 5px 4px; border-radius:6px;
}
[data-booking-studio] .bs-back:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-booking-studio] .bs-sep { color:var(--bs-ink-5); }
[data-booking-studio] .bs-crumbs { display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--bs-ink-3); }
[data-booking-studio] .bs-crumb-muted { color:var(--bs-ink-3); }
[data-booking-studio] .bs-crumb-cur { color:var(--bs-ink); font-weight:500; }
[data-booking-studio] .bs-spacer { flex:1; }
[data-booking-studio] .bs-pill {
  display:inline-flex; align-items:center; gap:5px;
  height:20px; padding:0 8px; border-radius:10px;
  background:var(--bs-bg-2); color:var(--bs-ink-3);
  font-size:11px; font-weight:500;
  border:1px solid var(--bs-border);
  margin-left:6px;
}
[data-booking-studio] .bs-pill .bs-pill-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-booking-studio] .bs-pill.live { background:var(--bs-green-soft); color:#2f5a35; border-color:#c6d4bc; }
[data-booking-studio] .bs-pill.live .bs-pill-dot { background:var(--bs-green); }
[data-booking-studio] .bs-pill.draft { background:var(--bs-amber-soft); color:#7a5b07; border-color:#e3d29a; }
[data-booking-studio] .bs-pill.draft .bs-pill-dot { background:var(--bs-amber); }
[data-booking-studio] .bs-pill.accent { background:var(--bs-accent-ghost); color:var(--bs-accent-2); border-color:#ecd4c6; height:16px; padding:0 6px; font-size:10px; }

/* ── BUTTONS ─────────────────────────────────────────────── */
[data-booking-studio] .bs-btn {
  display:inline-flex; align-items:center; gap:5px;
  height:28px; padding:0 10px; border-radius:6px;
  font-size:12.5px; font-weight:500;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  color:var(--bs-ink); box-shadow:var(--bs-shadow-1);
  text-decoration:none;
}
[data-booking-studio] .bs-btn:hover { background:var(--bs-bg-2); }
[data-booking-studio] .bs-btn.sm { height:24px; padding:0 8px; font-size:12px; }
[data-booking-studio] .bs-btn-ghost { background:transparent; border-color:transparent; box-shadow:none; color:var(--bs-ink-2); }
[data-booking-studio] .bs-btn-ghost:hover { background:var(--bs-bg-2); }
[data-booking-studio] .bs-btn-primary { background:var(--bs-accent); color:#fff; border-color:var(--bs-accent-2); }
[data-booking-studio] .bs-btn-primary:hover { background:var(--bs-accent-2); }
[data-booking-studio] .bs-btn-primary:disabled { opacity:.7; cursor:not-allowed; }
[data-booking-studio] .bs-btn-danger { background:var(--bs-paper); color:var(--bs-danger); border-color:#e8c9c7; }
[data-booking-studio] .bs-btn-danger:hover { background:#faf0f0; }

/* ── BANNER ──────────────────────────────────────────────── */
[data-booking-studio] .bs-banner {
  margin:10px 14px 0; padding:8px 12px; border-radius:6px; font-size:12.5px;
}
[data-booking-studio] .bs-banner.success { background:var(--bs-green-soft); color:#2f5a35; border:1px solid #c6d4bc; }
[data-booking-studio] .bs-banner.error { background:#faecea; color:#8a3a36; border:1px solid #e8c9c7; }

/* ── 3-PANE SHELL ────────────────────────────────────────── */
[data-booking-studio] .bs-shell {
  display:grid; grid-template-columns:264px 1fr 360px;
  flex:1; min-height:0;
}
[data-booking-studio] .bs-pane { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
[data-booking-studio] .bs-left { background:var(--bs-bg-2); border-right:1px solid var(--bs-border); overflow-y:auto; }
[data-booking-studio] .bs-center { background:#FAFAF7; }
[data-booking-studio] .bs-right { background:var(--bs-paper-2); border-left:1px solid var(--bs-border); overflow-y:auto; }

/* ── LEFT PANE ───────────────────────────────────────────── */
[data-booking-studio] .bs-section { padding:14px; border-bottom:1px solid var(--bs-border-soft); }
[data-booking-studio] .bs-seclabel {
  display:flex; align-items:center; justify-content:space-between;
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.7px;
  color:var(--bs-ink-3); margin-bottom:8px;
}
[data-booking-studio] .bs-seclabel.mt { margin-top:14px; }
[data-booking-studio] .bs-seclabel > span:first-child { display:inline-flex; align-items:center; gap:6px; }
[data-booking-studio] .bs-trigger-box {
  background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:8px;
  padding:8px 10px;
}
[data-booking-studio] .bs-trigger-help { font-size:11px; color:var(--bs-ink-4); margin-bottom:6px; }
[data-booking-studio] .bs-trigger-textarea {
  width:100%; min-height:64px; resize:vertical;
  background:var(--bs-accent-ghost); border:1px dashed #e5c8b8;
  border-radius:5px; padding:7px 9px;
  font-size:12.5px; line-height:1.45; color:var(--bs-ink);
  font-family:inherit;
}
[data-booking-studio] .bs-trigger-textarea:focus { outline:none; border-color:var(--bs-accent); }

[data-booking-studio] .bs-rows { display:flex; flex-direction:column; gap:1px; }
[data-booking-studio] .bs-row {
  display:flex; align-items:center; gap:8px;
  padding:7px 8px; border-radius:6px; position:relative;
  background:transparent; text-align:left; width:100%;
  transition:background .12s;
}
[data-booking-studio] .bs-row:hover { background:rgba(60,50,30,.04); }
[data-booking-studio] .bs-row.sel {
  background:var(--bs-paper);
  box-shadow:var(--bs-shadow-1), 0 0 0 1px var(--bs-border);
}
[data-booking-studio] .bs-row .bs-row-rail {
  position:absolute; left:-14px; top:6px; bottom:6px; width:2px;
  background:transparent; border-radius:2px;
}
[data-booking-studio] .bs-row.sel .bs-row-rail { background:var(--bs-accent); }
[data-booking-studio] .bs-row-meta { flex:1; min-width:0; }
[data-booking-studio] .bs-row-label { display:block; font-size:12.5px; font-weight:500; color:var(--bs-ink); line-height:1.2; }
[data-booking-studio] .bs-row.sel .bs-row-label { font-weight:600; }
[data-booking-studio] .bs-row-sub {
  display:block; font-size:11px; color:var(--bs-ink-4);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}

[data-booking-studio] .bs-leftfoot {
  padding:10px 14px; border-top:1px solid var(--bs-border-soft);
  background:var(--bs-bg-3);
  position:sticky; bottom:0;
}
[data-booking-studio] .bs-leftfoot-row {
  display:flex; justify-content:space-between; font-size:11px; color:var(--bs-ink-3);
}

/* ── CENTER PANE ─────────────────────────────────────────── */
[data-booking-studio] .bs-canvas-toolbar {
  display:flex; align-items:center; gap:8px;
  padding:10px 14px; font-size:11.5px; color:var(--bs-ink-4);
  border-bottom:1px solid var(--bs-border-soft);
  background:var(--bs-paper-2);
}
[data-booking-studio] .bs-mute { color:var(--bs-ink-4); }
[data-booking-studio] .bs-canvas-full {
  flex:1; min-height:0; overflow-y:auto; background:#FAFAF7;
}
[data-booking-studio] .bs-canvas-full > main { min-height:100%; }

/* ── RIGHT PANE / INSPECTOR ──────────────────────────────── */
[data-booking-studio] .bs-insp { display:flex; flex-direction:column; }
[data-booking-studio] .bs-insphead {
  display:flex; align-items:flex-start; gap:10px;
  padding:14px 16px; border-bottom:1px solid var(--bs-border-soft);
  background:var(--bs-paper);
}
[data-booking-studio] .bs-insphead-icon {
  width:28px; height:28px; border-radius:7px;
  background:var(--bs-accent-ghost); color:var(--bs-accent-2);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
[data-booking-studio] .bs-insphead-title { font-size:13.5px; font-weight:600; letter-spacing:-.1px; }
[data-booking-studio] .bs-insphead-sub { font-size:11.5px; color:var(--bs-ink-4); margin-top:1px; }
[data-booking-studio] .bs-group { padding:12px 16px; border-bottom:1px solid var(--bs-border-soft); }
[data-booking-studio] .bs-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
[data-booking-studio] .bs-field:last-child { margin-bottom:0; }
[data-booking-studio] .bs-field-label { font-size:11.5px; font-weight:500; color:var(--bs-ink-2); }
[data-booking-studio] .bs-field-hint { font-size:11px; color:var(--bs-ink-4); margin-top:2px; }
[data-booking-studio] .bs-help { font-size:11.5px; color:var(--bs-ink-3); line-height:1.5; margin:0 0 10px; }

[data-booking-studio] .bs-input, [data-booking-studio] .bs-textarea, [data-booking-studio] .bs-select {
  width:100%; background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:5px; padding:6px 8px; font-size:12.5px; color:var(--bs-ink);
  height:28px;
}
[data-booking-studio] .bs-input.sm { height:24px; font-size:12px; }
[data-booking-studio] .bs-textarea { height:auto; min-height:60px; resize:vertical; font-family:inherit; line-height:1.45; }
[data-booking-studio] .bs-select { padding-right:24px; }
[data-booking-studio] .bs-input:focus, [data-booking-studio] .bs-textarea:focus, [data-booking-studio] .bs-select:focus {
  outline:none; border-color:var(--bs-accent); box-shadow:0 0 0 3px var(--bs-accent-ghost);
}
[data-booking-studio] .bs-input.mono { font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace; }

[data-booking-studio] .bs-input-affix {
  display:flex; align-items:center; background:var(--bs-paper);
  border:1px solid var(--bs-border-strong); border-radius:5px; overflow:hidden;
}
[data-booking-studio] .bs-input-affix .bs-prefix {
  padding:0 8px; font-size:12px; color:var(--bs-ink-4); background:var(--bs-bg-2);
  height:28px; display:inline-flex; align-items:center; border-right:1px solid var(--bs-border-strong);
  font-family: ui-monospace,Menlo,monospace;
}
[data-booking-studio] .bs-input-affix input { flex:1; border:0; padding:0 8px; height:28px; background:transparent; outline:none; font-size:12.5px; }

[data-booking-studio] .bs-input-suffix {
  display:flex; align-items:center; gap:6px;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:5px; padding:0 8px; height:28px; font-size:12.5px;
}
[data-booking-studio] .bs-input-suffix input { flex:1; border:0; background:transparent; outline:none; width:0; min-width:0; font-size:12.5px; }
[data-booking-studio] .bs-input-suffix span { color:var(--bs-ink-4); font-size:11px; }

[data-booking-studio] .bs-segment {
  display:inline-flex; background:var(--bs-bg-2); border-radius:6px; padding:2px; gap:1px;
}
[data-booking-studio] .bs-segbtn {
  height:22px; padding:0 9px; border-radius:5px;
  font-size:11.5px; font-weight:500; color:var(--bs-ink-3);
  display:inline-flex; align-items:center; gap:5px;
}
[data-booking-studio] .bs-segbtn.on {
  background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1);
}
[data-booking-studio] .bs-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-booking-studio] .bs-dot.draft { background:var(--bs-amber); }
[data-booking-studio] .bs-dot.published { background:var(--bs-green); }
[data-booking-studio] .bs-dot.archived { background:var(--bs-ink-4); }

[data-booking-studio] .bs-link {
  display:inline-flex; align-items:center; gap:4px;
  font-size:11.5px; font-weight:500; color:var(--bs-accent-2);
}
[data-booking-studio] .bs-link:hover { color:var(--bs-accent); }

/* ── Week grid ───────────────────────────────────────────── */
[data-booking-studio] .bs-week { display:flex; flex-direction:column; gap:4px; }
[data-booking-studio] .bs-day {
  display:flex; align-items:flex-start; gap:8px; padding:4px 0;
  transition:opacity .12s;
}
[data-booking-studio] .bs-day.off { opacity:.55; }
[data-booking-studio] .bs-day-label {
  width:36px; flex-shrink:0; text-align:left;
  font-size:11px; font-weight:600; letter-spacing:.4px; text-transform:uppercase;
  color:var(--bs-ink); padding-top:4px;
}
[data-booking-studio] .bs-day.off .bs-day-label { color:var(--bs-ink-4); }
[data-booking-studio] .bs-day-windows { flex:1; display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
[data-booking-studio] .bs-empty { font-size:11px; color:var(--bs-ink-4); padding:3px 0; }
[data-booking-studio] .bs-window {
  display:inline-flex; align-items:center; gap:3px;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:4px; padding:2px 4px 2px 6px;
  font-size:11px; font-family: ui-monospace,Menlo,monospace;
}
[data-booking-studio] .bs-window input[type="time"] {
  width:62px; border:0; background:transparent; padding:0; font-size:11px;
  font-family: ui-monospace,Menlo,monospace; outline:none; color:var(--bs-ink);
}
[data-booking-studio] .bs-window-x { color:var(--bs-ink-5); margin-left:2px; display:inline-flex; }
[data-booking-studio] .bs-window-x:hover { color:var(--bs-danger); }
[data-booking-studio] .bs-add-window {
  padding:2px 8px; font-size:11px; color:var(--bs-ink-3);
  border:1px dashed var(--bs-border-strong); border-radius:4px;
}
[data-booking-studio] .bs-add-window:hover { border-color:var(--bs-accent); color:var(--bs-accent-2); }

/* ── Callout ─────────────────────────────────────────────── */
[data-booking-studio] .bs-callout {
  margin:0 16px 14px; padding:10px 12px;
  background:var(--bs-accent-ghost); color:var(--bs-accent-2);
  border-radius:6px;
  display:flex; gap:8px; align-items:flex-start;
  font-size:11.5px; line-height:1.4;
}
[data-booking-studio] .bs-callout b { font-weight:600; }

/* ── Field cards (form fields list) ──────────────────────── */
[data-booking-studio] .bs-fieldcard {
  background:var(--bs-paper); border:1px solid var(--bs-border);
  border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px;
}
[data-booking-studio] .bs-fieldcard-row { display:flex; gap:6px; align-items:center; }
[data-booking-studio] .bs-fieldcard-row > .bs-input { flex:1; }
[data-booking-studio] .bs-fieldcard-row > .bs-select { width:auto; min-width:110px; }
[data-booking-studio] .bs-check { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--bs-ink-2); cursor:pointer; }
[data-booking-studio] .bs-iconbtn {
  display:inline-flex; align-items:center; justify-content:center;
  width:24px; height:24px; border-radius:4px; color:var(--bs-ink-4);
}
[data-booking-studio] .bs-iconbtn:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-booking-studio] .bs-iconbtn.danger:hover { background:#faecea; color:var(--bs-danger); }

[data-booking-studio] .bs-empty-state {
  display:flex; flex-direction:column; align-items:center; gap:8px;
  padding:24px 12px; border:1px dashed var(--bs-border-strong); border-radius:8px;
  color:var(--bs-ink-4); font-size:12px; text-align:center; background:var(--bs-paper);
}

/* ── Swatches ────────────────────────────────────────────── */
[data-booking-studio] .bs-swatches { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
[data-booking-studio] .bs-swatch {
  width:22px; height:22px; border-radius:5px; border:0; cursor:pointer;
  box-shadow:0 0 0 1px rgba(0,0,0,.06);
}
[data-booking-studio] .bs-swatch.on {
  box-shadow:0 0 0 2px var(--bs-paper), 0 0 0 4px var(--bs-accent);
}
[data-booking-studio] .bs-color { width:30px; height:24px; border:1px solid var(--bs-border-strong); border-radius:5px; background:var(--bs-paper); padding:0; cursor:pointer; }
[data-booking-studio] .bs-color-row { display:flex; gap:6px; align-items:center; }
[data-booking-studio] .bs-color-row input[type="color"] { width:32px; height:28px; border:1px solid var(--bs-border-strong); border-radius:5px; padding:0; cursor:pointer; background:var(--bs-paper); }

/* ── Danger zone ─────────────────────────────────────────── */
[data-booking-studio] .bs-danger {
  margin:16px 14px; padding:14px 16px;
  background:var(--bs-paper); border:1px solid #e8c9c7;
  border-radius:8px;
  display:flex; align-items:center; justify-content:space-between; gap:12px;
}
[data-booking-studio] .bs-danger h3 { margin:0; font-size:13px; font-weight:600; color:var(--bs-danger); }
[data-booking-studio] .bs-danger p { margin:2px 0 0; font-size:11.5px; color:var(--bs-ink-3); }

/* ── Mobile pane tabs ────────────────────────────────────── */
[data-booking-studio] .bs-mobile-tabs { display:none; }
@media (max-width: 960px) {
  [data-booking-studio] .bs-shell { grid-template-columns: 1fr; }
  [data-booking-studio] .bs-pane { display:none; }
  [data-booking-studio] .bs-pane.mobile-active { display:flex; }
  [data-booking-studio] .bs-left, [data-booking-studio] .bs-right { border:0; }
  [data-booking-studio] .bs-mobile-tabs {
    display:flex; gap:4px; padding:8px 12px;
    background:var(--bs-paper-2); border-bottom:1px solid var(--bs-border);
  }
  [data-booking-studio] .bs-mobile-tab {
    flex:1; padding:8px 0; border-radius:6px;
    font-size:12.5px; font-weight:500; color:var(--bs-ink-3);
    background:var(--bs-bg-2);
  }
  [data-booking-studio] .bs-mobile-tab.active { background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1); }
}
    `}</style>
  )
}
