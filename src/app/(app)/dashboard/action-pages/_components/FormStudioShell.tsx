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
import { FormStudioPreview } from './FormStudioPreview'
import { CopyField } from './CopyField'
import { PipelineRulesEditor } from './PipelineRulesEditor'
import { TriggerGuard } from './TriggerGuard'
import { TriggerField } from './TriggerField'
import { DraftSaveModal } from './DraftSaveModal'
import { useDraftGate } from './useDraftGate'
import { EchoTemplateField } from './EchoTemplateField'
import { extractCustomKeysFromConfig } from '../_lib/custom-keys'
import {
  FIELD_KEY_RE,
  FIELD_KINDS,
  parseFormConfig,
  type DescriptionBlock,
  type FieldBlock,
  type FieldKind,
  type FormBlock,
  type FormConfig,
  type HeadingBlock,
} from '@/app/a/[slug]/_kinds/form/schema'

type BasicsId = 'basics' | 'theme' | 'branding' | 'submit'
type AfterId = 'pipeline' | 'conversion' | 'echo' | 'share'
type SelectedId = BasicsId | AfterId | string // string = block.id

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

const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  select: 'Select',
  checkbox: 'Checkbox',
  radio: 'Radio',
}

const FIELD_KIND_ICON: Record<FieldKind, IconName> = {
  short_text: 'text',
  long_text: 'text',
  email: 'mail',
  phone: 'phone',
  number: 'cmd',
  select: 'chevDown',
  checkbox: 'check',
  radio: 'radio',
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  if (!base) return 'field'
  if (!/^[a-z]/.test(base)) return `f_${base}`.slice(0, 40)
  return base
}

export function FormStudioShell({
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

  const initialConfig = useMemo<FormConfig>(
    () => parseFormConfig(page.config),
    [page.config],
  )

  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description ?? '')
  const [slug, setSlug] = useState(page.slug)
  const [status, setStatus] = useState<ActionPageRow['status']>(page.status)
  const [config, setConfig] = useState<FormConfig>(initialConfig)

  // Auto-select the first field block (the design lands with "Medium" selected);
  // fall back to 'basics' if there are no field blocks.
  const initialSelected: SelectedId = useMemo(() => {
    const firstField = initialConfig.blocks.find((b) => b.type === 'field')
    return firstField ? firstField.id : 'basics'
  }, [initialConfig])
  const [selected, setSelected] = useState<SelectedId>(initialSelected)
  const [mobilePane, setMobilePane] = useState<'tree' | 'preview' | 'inspector'>(
    'tree',
  )

  const formRef = useRef<HTMLFormElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const draftGate = useDraftGate({ status, setStatus })

  // Hide the app chrome while the studio is mounted; reuse the booking
  // studio's body attribute since the chrome-hide CSS already targets it.
  useEffect(() => {
    document.body.dataset.bookingStudio = '1'
    document.body.dataset.formStudio = '1'
    return () => {
      delete document.body.dataset.bookingStudio
      delete document.body.dataset.formStudio
    }
  }, [])

  // ── config helpers ──────────────────────────────────────────────
  const patchTheme = (p: Partial<FormConfig['theme']>) =>
    setConfig((c) => ({ ...c, theme: { ...c.theme, ...p } }))
  const patchBranding = (p: Partial<FormConfig['branding']>) =>
    setConfig((c) => ({ ...c, branding: { ...c.branding, ...p } }))
  const setSubmitLabel = (v: string) =>
    setConfig((c) => ({ ...c, submit_button_label: v.slice(0, 60) || 'Submit' }))
  const setSuccessMessage = (v: string) =>
    setConfig((c) => ({ ...c, success_message: v.slice(0, 400) }))

  const setBlocks = (next: FormBlock[]) =>
    setConfig((c) => ({ ...c, blocks: next }))

  const addBlock = (type: FormBlock['type']) => {
    let block: FormBlock
    if (type === 'heading') {
      const h: HeadingBlock = {
        id: uuid(),
        type: 'heading',
        text: 'Section heading',
        level: 2,
      }
      block = h
    } else if (type === 'description') {
      const d: DescriptionBlock = {
        id: uuid(),
        type: 'description',
        text: 'Add helper text or context for the form below.',
      }
      block = d
    } else {
      const idx = config.blocks.filter((b) => b.type === 'field').length + 1
      const f: FieldBlock = {
        id: uuid(),
        type: 'field',
        key: `field_${idx}`,
        label: `Question ${idx}`,
        field_kind: 'short_text',
        required: false,
      }
      block = f
    }
    setBlocks([...config.blocks, block])
    setSelected(block.id)
  }

  const removeBlock = (id: string) => {
    const next = config.blocks.filter((b) => b.id !== id)
    setBlocks(next)
    if (selected === id) {
      setSelected(next[0]?.id ?? 'basics')
    }
  }

  const duplicateBlock = (id: string) => {
    const idx = config.blocks.findIndex((b) => b.id === id)
    if (idx < 0) return
    const src = config.blocks[idx]
    if (!src) return
    let copy: FormBlock
    if (src.type === 'field') {
      copy = { ...src, id: uuid(), key: `${src.key}_copy`.slice(0, 40) }
    } else {
      copy = { ...src, id: uuid() } as FormBlock
    }
    const next = [...config.blocks]
    next.splice(idx + 1, 0, copy)
    setBlocks(next)
    setSelected(copy.id)
  }

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = config.blocks.findIndex((b) => b.id === id)
    if (idx < 0) return
    const next = [...config.blocks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    const a = next[idx]
    const b = next[target]
    if (!a || !b) return
    next[idx] = b
    next[target] = a
    setBlocks(next)
  }

  const patchBlock = (id: string, patch: Partial<FormBlock>) => {
    setBlocks(
      config.blocks.map((b) =>
        b.id === id ? ({ ...b, ...patch } as FormBlock) : b,
      ),
    )
  }

  // Options helpers for select/radio fields
  const patchFieldOptions = (
    id: string,
    options: Array<{ label: string; value: string }>,
  ) => patchBlock(id, { options } as Partial<FieldBlock>)

  // ── derived ─────────────────────────────────────────────────────
  const fieldBlocks = config.blocks.filter(
    (b): b is FieldBlock => b.type === 'field',
  )
  const requiredCount = fieldBlocks.filter((f) => f.required).length
  const selectedBlock = config.blocks.find((b) => b.id === selected) ?? null

  const onSelect = (id: SelectedId) => {
    setSelected(id)
    setMobilePane('inspector')
  }

  const setupItems: { id: BasicsId; label: string; sub: string; icon: IconName }[] =
    [
      { id: 'basics', label: 'Basics', sub: `/${slug}`, icon: 'info' },
      {
        id: 'theme',
        label: 'Theme',
        sub: `${config.theme.background_color} · ${config.theme.accent_color}`,
        icon: 'sparkle',
      },
      {
        id: 'branding',
        label: 'Branding',
        sub: config.branding.logo_url ? 'Logo set' : 'No logo',
        icon: 'image',
      },
      {
        id: 'submit',
        label: 'Submit & confirm',
        sub: config.submit_button_label,
        icon: 'check',
      },
    ]

  const afterItems: { id: AfterId; label: string; sub: string; icon: IconName }[] =
    [
      {
        id: 'pipeline',
        label: 'Pipeline',
        sub: `${page.pipeline_rules.length} rule${page.pipeline_rules.length === 1 ? '' : 's'}`,
        icon: 'pipeline',
      },
      {
        id: 'conversion',
        label: 'Conversion event',
        sub: page.capi_event_name_override ?? 'LeadSubmitted',
        icon: 'target',
      },
      {
        id: 'echo',
        label: 'Messenger echo',
        sub: page.notification_template?.text ? 'Set' : 'Empty',
        icon: 'message',
      },
      {
        id: 'share',
        label: 'Share & embed',
        sub: `/a/${slug}`,
        icon: 'share',
      },
    ]

  return (
    <div data-booking-studio data-form-studio>
      <FormStudioStyles />
      <form ref={formRef} action={updateActionPage} className="bs-form">
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="config" value={JSON.stringify(config)} />

        {/* ─── TOP BAR ───────────────────────────────────────── */}
        <header className="bs-topbar">
          <TriggerGuard
            pageId={page.id}
            initialTrigger={page.bot_send_instructions}
            backHref="/dashboard/action-pages"
            className="bs-back"
            onJumpToTrigger={() => setSelected('echo')}
          >
            <Icon name="chevLeft" size={14} /> Back
          </TriggerGuard>
          <span className="bs-sep">/</span>
          <div className="bs-crumbs">
            <span className="bs-crumb-muted">Action pages</span>
            <Icon name="chevRight" size={11} />
            <span className="bs-crumb-cur">{title || page.title || 'Untitled'}</span>
            <span className="bs-pill accent">
              <Icon name="form" size={10} /> Form
            </span>
            <span
              className={`bs-pill ${status === 'published' ? 'live' : status === 'draft' ? 'draft' : ''}`}
            >
              <span className="bs-pill-dot" />
              {status === 'published'
                ? 'Live'
                : status === 'draft'
                  ? 'Draft'
                  : 'Archived'}
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
          <aside
            className={`bs-pane bs-left ${mobilePane === 'tree' ? 'mobile-active' : ''}`}
          >
            {/* Bot trigger */}
            <div className="bs-section bs-trigger">
              <div className="bs-seclabel">
                <span>
                  <Icon name="bot" size={11} /> Bot trigger
                </span>
                <span className="bs-pill accent">
                  <Icon name="sparkle" size={9} /> AI
                </span>
              </div>
              <CtaLabelField defaultValue={page.cta_label ?? ''} />
              <div className="bs-trigger-box">
                <div className="bs-trigger-help">Send this page when…</div>
                <TriggerField
                  initial={page.bot_send_instructions ?? ''}
                  defaultText={meta.defaultBotSendInstructions}
                  rows={3}
                  placeholder="Send when the lead asks about applying, requests info, or mentions our open call."
                  className="bs-trigger-textarea"
                />
              </div>
            </div>

            {/* Page blocks tree */}
            <div className="bs-section bs-blocks">
              <div className="bs-seclabel">
                <span>
                  <Icon name="layers" size={11} /> Page blocks
                  <span className="fs-count">· {config.blocks.length}</span>
                </span>
              </div>
              <div className="bs-rows">
                {config.blocks.length === 0 && (
                  <div className="bs-empty-state">
                    <Icon name="form" size={18} />
                    <div>No blocks yet</div>
                    <button
                      type="button"
                      className="bs-btn bs-btn-ghost sm"
                      onClick={() => addBlock('field')}
                    >
                      <Icon name="plus" size={11} /> Add first field
                    </button>
                  </div>
                )}
                {config.blocks.map((b) => (
                  <FormBlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>

              <div className="fs-addsplit">
                <button
                  type="button"
                  className="fs-addbtn"
                  onClick={() => addBlock('heading')}
                >
                  <Icon name="plus" size={10} /> Heading
                </button>
                <button
                  type="button"
                  className="fs-addbtn"
                  onClick={() => addBlock('description')}
                >
                  <Icon name="plus" size={10} /> Description
                </button>
                <button
                  type="button"
                  className="fs-addbtn"
                  onClick={() => addBlock('field')}
                >
                  <Icon name="plus" size={10} /> Field
                </button>
              </div>

              <div className="bs-seclabel mt">
                <span>
                  <Icon name="settings" size={11} /> Page setup
                </span>
              </div>
              <div className="bs-rows">
                {setupItems.map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>

              <div className="bs-seclabel mt">
                <span>
                  <Icon name="sliders" size={11} /> After submit
                </span>
              </div>
              <div className="bs-rows">
                {afterItems.map((b) => (
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
                <span>
                  {fieldBlocks.length} field{fieldBlocks.length === 1 ? '' : 's'}
                  {requiredCount ? ` · ${requiredCount} required` : ''}
                </span>
                <span className="mono">/a/{slug}</span>
              </div>
            </div>
          </aside>

          {/* CENTER */}
          <main
            className={`bs-pane bs-center ${mobilePane === 'preview' ? 'mobile-active' : ''}`}
          >
            <div className="bs-canvas-toolbar">
              <Icon name="eye" size={12} />
              <span>Live preview · what a lead sees at /a/{slug}</span>
              <div className="bs-spacer" />
              <span className="bs-mute">Click a block on the left to edit it</span>
            </div>
            <div className="bs-canvas-full fs-canvas">
              <FormStudioPreview
                title={title}
                description={description}
                slug={slug}
                config={config}
                selectedBlockId={
                  typeof selected === 'string' ? selected : null
                }
                operatorWordmark={title}
                previewRef={previewRef}
              />
            </div>
          </main>

          {/* RIGHT — every inspector is mounted so its hidden inputs always
              submit with the form. We hide the non-selected ones. */}
          <aside
            className={`bs-pane bs-right ${mobilePane === 'inspector' ? 'mobile-active' : ''}`}
          >
            {/* Selected block inspectors (one rendered at a time when a block is picked) */}
            {selectedBlock && selectedBlock.type === 'field' && (
              <InspectorField
                field={selectedBlock}
                onPatch={(p) => patchBlock(selectedBlock.id, p)}
                onSetOptions={(opts) => patchFieldOptions(selectedBlock.id, opts)}
                onMove={(dir) => moveBlock(selectedBlock.id, dir)}
                onDuplicate={() => duplicateBlock(selectedBlock.id)}
                onRemove={() => removeBlock(selectedBlock.id)}
              />
            )}
            {selectedBlock && selectedBlock.type === 'heading' && (
              <InspectorHeading
                block={selectedBlock}
                onPatch={(p) => patchBlock(selectedBlock.id, p)}
                onMove={(dir) => moveBlock(selectedBlock.id, dir)}
                onDuplicate={() => duplicateBlock(selectedBlock.id)}
                onRemove={() => removeBlock(selectedBlock.id)}
              />
            )}
            {selectedBlock && selectedBlock.type === 'description' && (
              <InspectorDescription
                block={selectedBlock}
                onPatch={(p) => patchBlock(selectedBlock.id, p)}
                onMove={(dir) => moveBlock(selectedBlock.id, dir)}
                onDuplicate={() => duplicateBlock(selectedBlock.id)}
                onRemove={() => removeBlock(selectedBlock.id)}
              />
            )}

            <InspectorSlot active={selected === 'basics'}>
              <InspectorBasics
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
            <InspectorSlot active={selected === 'theme'}>
              <InspectorTheme theme={config.theme} onPatch={patchTheme} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'branding'}>
              <InspectorBranding
                branding={config.branding}
                onPatch={patchBranding}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'submit'}>
              <InspectorSubmit
                buttonLabel={config.submit_button_label}
                onButtonLabel={setSubmitLabel}
                successMessage={config.success_message}
                onSuccessMessage={setSuccessMessage}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'pipeline'}>
              <InspectorPipeline page={page} stages={stages} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'conversion'}>
              <InspectorConversion
                defaultValue={page.capi_event_name_override ?? ''}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'echo'}>
              <InspectorEcho page={page} />
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

      <DangerZone id={page.id} />

      <DraftSaveModal {...draftGate.modalProps} />
    </div>
  )
}

// ─── CTA label (Messenger send button) ────────────────────────────
function CtaLabelField({ defaultValue }: { defaultValue: string }) {
  const [v, setV] = useState(defaultValue)
  return (
    <div className="fs-cta-row">
      <span className="fs-cta-label">CTA</span>
      <input
        name="cta_label"
        value={v}
        onChange={(e) => setV(e.target.value.slice(0, 50))}
        placeholder="Apply now"
        maxLength={50}
        className="fs-cta-input"
      />
    </div>
  )
}

// ─── save / danger ────────────────────────────────────────────────
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
        <p>
          Deleting an action page is permanent. Past submissions are kept on the
          lead records.
        </p>
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

function InspectorSlot({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>
}

// ─── block rows ───────────────────────────────────────────────────
function BlockRow({
  block,
  selected,
  onClick,
}: {
  block: { id: string; label: string; sub: string; icon: IconName }
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
      <Icon
        name={block.icon}
        size={13}
        color={selected ? 'var(--bs-accent-2)' : 'var(--bs-ink-3)'}
      />
      <span className="bs-row-meta">
        <span className="bs-row-label">{block.label}</span>
        <span className="bs-row-sub">{block.sub}</span>
      </span>
    </button>
  )
}

function FormBlockRow({
  block,
  selected,
  onClick,
}: {
  block: FormBlock
  selected: boolean
  onClick: () => void
}) {
  let icon: IconName = 'text'
  let kindLabel = ''
  let label = ''
  let required = false
  if (block.type === 'heading') {
    icon = 'text'
    kindLabel = `H${block.level}`
    label = block.text || 'Heading'
  } else if (block.type === 'description') {
    icon = 'text'
    kindLabel = 'Body'
    label = block.text || 'Description'
  } else {
    icon = FIELD_KIND_ICON[block.field_kind]
    kindLabel = FIELD_KIND_LABEL[block.field_kind]
    label = block.label
    required = block.required
  }
  return (
    <button
      type="button"
      className={`bs-row ${selected ? 'sel' : ''}`}
      onClick={onClick}
    >
      <span className="bs-row-rail" aria-hidden />
      <Icon name="grip" size={11} color="var(--bs-ink-5)" />
      <span className="fs-row-icon">
        <Icon
          name={icon}
          size={10}
          color={selected ? 'var(--bs-accent-2)' : 'var(--bs-ink-3)'}
        />
      </span>
      <span className="bs-row-meta">
        <span className="bs-row-label">{label}</span>
        <span className="bs-row-sub">
          {kindLabel}
          {required ? ' · required' : ''}
        </span>
      </span>
    </button>
  )
}

// ─── inspector chrome ─────────────────────────────────────────────
function InspectorHead({
  icon,
  title,
  sub,
}: {
  icon: IconName
  title: string
  sub: ReactNode
}) {
  return (
    <div className="bs-insphead">
      <div className="bs-insphead-icon">
        <Icon name={icon} size={15} />
      </div>
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
  label: ReactNode
  hint?: ReactNode
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

function BlockActionFooter({
  onMove,
  onDuplicate,
  onRemove,
}: {
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="bs-group">
      <div className="fs-action-row">
        <button
          type="button"
          className="bs-btn sm"
          onClick={() => onMove(-1)}
        >
          <Icon name="chevDown" size={12} style={{ transform: 'rotate(180deg)' }} />
          Move up
        </button>
        <button
          type="button"
          className="bs-btn sm"
          onClick={() => onMove(1)}
        >
          <Icon name="chevDown" size={12} />
          Move down
        </button>
        <button
          type="button"
          className="bs-btn sm"
          onClick={onDuplicate}
        >
          <Icon name="layers" size={12} />
          Duplicate
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          if (confirm('Remove this block?')) onRemove()
        }}
        className="fs-remove"
      >
        Remove block
      </button>
    </div>
  )
}

// ─── Inspector: Field (showpiece with Options sub-editor) ─────────
function InspectorField({
  field,
  onPatch,
  onSetOptions,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: FieldBlock
  onPatch: (patch: Partial<FieldBlock>) => void
  onSetOptions: (opts: Array<{ label: string; value: string }>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const hasOptions =
    field.field_kind === 'select' || field.field_kind === 'radio'
  const isCheckbox = field.field_kind === 'checkbox'
  const [keyTouched, setKeyTouched] = useState<boolean>(
    field.key !== slugifyKey(field.label),
  )

  const onLabelChange = (label: string) => {
    if (!keyTouched) {
      onPatch({ label: label.slice(0, 120), key: slugifyKey(label) })
    } else {
      onPatch({ label: label.slice(0, 120) })
    }
  }

  const keyValid = FIELD_KEY_RE.test(field.key)

  return (
    <div className="bs-insp">
      <InspectorHead
        icon={FIELD_KIND_ICON[field.field_kind]}
        title={field.label || 'Field'}
        sub={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="bs-pill">{FIELD_KIND_LABEL[field.field_kind]}</span>
            Field block · {field.required ? 'required' : 'optional'}
          </span>
        }
      />

      <InspGroup>
        <Field label="Label">
          <input
            className="bs-input"
            value={field.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Question label"
          />
          <span className="bs-field-hint">
            Auto-syncs <span className="mono">key</span> until you edit it manually.
          </span>
        </Field>
        <Field
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Key
            </span>
          }
        >
          <div className="bs-input-affix">
            <span className="bs-prefix">fields.</span>
            <input
              className="mono"
              value={field.key}
              onChange={(e) => {
                setKeyTouched(true)
                onPatch({
                  key: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, '_')
                    .slice(0, 40),
                })
              }}
              pattern={FIELD_KEY_RE.source}
              style={{ flex: 1 }}
            />
            {keyValid && (
              <span style={{ paddingRight: 8, color: 'var(--bs-green)' }}>
                <Icon name="check" size={12} />
              </span>
            )}
          </div>
          <span className="bs-field-hint">
            {keyValid ? (
              <>
                lowercase + digits + underscores · use in templates like{' '}
                <span className="mono">{`{${field.key}}`}</span>
              </>
            ) : (
              <span style={{ color: 'var(--bs-danger)' }}>
                Must start with a letter; lowercase, digits, underscores only.
              </span>
            )}
          </span>
        </Field>
        <Field label="Field kind">
          <select
            className="bs-select"
            value={field.field_kind}
            onChange={(e) => {
              const k = e.target.value as FieldKind
              const patch: Partial<FieldBlock> = { field_kind: k }
              if ((k === 'select' || k === 'radio') && !field.options) {
                patch.options = [
                  { label: 'Option 1', value: 'option_1' },
                  { label: 'Option 2', value: 'option_2' },
                ]
              }
              onPatch(patch)
            }}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {FIELD_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {!hasOptions && !isCheckbox && (
          <Field label="Placeholder">
            <input
              className="bs-input"
              value={field.placeholder ?? ''}
              onChange={(e) =>
                onPatch({ placeholder: e.target.value || undefined })
              }
              placeholder="Helper text inside the input"
            />
          </Field>
        )}
        <label className="bs-check fs-required-row">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onPatch({ required: e.target.checked })}
          />
          Required
        </label>
      </InspGroup>

      {hasOptions && (
        <InspGroup
          label={
            <>
              <Icon name="list" size={11} /> Options
            </>
          }
          action={
            <button
              type="button"
              className="bs-link"
              onClick={() => {
                const next = [
                  ...(field.options ?? []),
                  {
                    label: `Option ${(field.options?.length ?? 0) + 1}`,
                    value: `option_${(field.options?.length ?? 0) + 1}`,
                  },
                ]
                onSetOptions(next)
              }}
            >
              <Icon name="plus" size={11} /> Add option
            </button>
          }
        >
          <div className="fs-options">
            {(field.options ?? []).length === 0 && (
              <div className="bs-empty-state">
                <Icon name="list" size={16} />
                <div>No options yet</div>
              </div>
            )}
            {(field.options ?? []).map((o, i) => (
              <div key={`${i}-${o.value}`} className="fs-option-row">
                <span className="fs-option-grip">
                  <Icon name="grip" size={11} color="var(--bs-ink-5)" />
                </span>
                <input
                  className="fs-option-label"
                  value={o.label}
                  onChange={(e) => {
                    const next = (field.options ?? []).map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    )
                    onSetOptions(next)
                  }}
                  placeholder="Label"
                />
                <input
                  className="fs-option-value mono"
                  value={o.value}
                  onChange={(e) => {
                    const next = (field.options ?? []).map((x, j) =>
                      j === i ? { ...x, value: e.target.value } : x,
                    )
                    onSetOptions(next)
                  }}
                  placeholder="value"
                />
                <button
                  type="button"
                  className="bs-iconbtn danger"
                  onClick={() => {
                    const next = (field.options ?? []).filter((_, j) => j !== i)
                    onSetOptions(next)
                  }}
                  aria-label="Remove option"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="bs-field-hint">
            Values are sent to your CRM and downstream tools.
          </div>
        </InspGroup>
      )}

      <BlockActionFooter
        onMove={onMove}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  )
}

// ─── Inspector: Heading ───────────────────────────────────────────
function InspectorHeading({
  block,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: HeadingBlock
  onPatch: (patch: Partial<HeadingBlock>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="text" title="Heading" sub="On-page heading block" />
      <InspGroup>
        <Field label="Text">
          <textarea
            className="bs-textarea"
            rows={2}
            value={block.text}
            onChange={(e) =>
              onPatch({ text: e.target.value.slice(0, 200) })
            }
          />
        </Field>
        <Field label="Level">
          <div className="bs-segment">
            {[1, 2, 3].map((lvl) => (
              <button
                type="button"
                key={lvl}
                onClick={() => onPatch({ level: lvl as 1 | 2 | 3 })}
                className={`bs-segbtn ${block.level === lvl ? 'on' : ''}`}
              >
                H{lvl}
              </button>
            ))}
          </div>
        </Field>
      </InspGroup>
      <BlockActionFooter
        onMove={onMove}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  )
}

// ─── Inspector: Description ───────────────────────────────────────
function InspectorDescription({
  block,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: DescriptionBlock
  onPatch: (patch: Partial<DescriptionBlock>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="text" title="Description" sub="Body copy block" />
      <InspGroup>
        <Field label="Text">
          <textarea
            className="bs-textarea"
            rows={5}
            value={block.text}
            onChange={(e) =>
              onPatch({ text: e.target.value.slice(0, 2000) })
            }
          />
          <span className="bs-field-hint">{block.text.length}/2000</span>
        </Field>
      </InspGroup>
      <BlockActionFooter
        onMove={onMove}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </div>
  )
}

// ─── Inspector: Basics ────────────────────────────────────────────
function InspectorBasics({
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
      <InspectorHead icon="info" title="Basics" sub="Title, slug, status" />
      <InspGroup label="Title">
        <input
          className="bs-input"
          value={title}
          onChange={(e) => onTitle(e.target.value.slice(0, 120))}
          maxLength={120}
          placeholder="e.g. Spring 2026 residency application"
        />
        <span className="bs-field-hint">{title.length}/120</span>
      </InspGroup>
      <InspGroup label="Description">
        <textarea
          className="bs-textarea"
          rows={4}
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
          placeholder="One or two sentences leads see first."
        />
        <span className="bs-field-hint">
          Markdown supported · {description.length}/2000
        </span>
      </InspGroup>
      <InspGroup label="URL slug">
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
            style={{ flex: 1 }}
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

// ─── Inspector: Theme ─────────────────────────────────────────────
function InspectorTheme({
  theme,
  onPatch,
}: {
  theme: FormConfig['theme']
  onPatch: (p: Partial<FormConfig['theme']>) => void
}) {
  const presets = [
    { bg: '#ffffff', accent: '#059669', fg: '#ffffff', name: 'Paper · Emerald' },
    { bg: '#f7f2e8', accent: '#3d5a4c', fg: '#fbf7f0', name: 'Cream · Sea' },
    { bg: '#1a1814', accent: '#d97757', fg: '#fbf7f0', name: 'Dusk · Coral' },
    { bg: '#ffffff', accent: '#1a1a1a', fg: '#ffffff', name: 'Paper · Ink' },
  ]
  return (
    <div className="bs-insp">
      <InspectorHead icon="sparkle" title="Theme" sub="Colors for this page" />
      <InspGroup>
        <Field label="Background">
          <ColorInput
            value={theme.background_color}
            onChange={(v) => onPatch({ background_color: v })}
          />
        </Field>
        <Field label="Accent / button">
          <ColorInput
            value={theme.accent_color}
            onChange={(v) => onPatch({ accent_color: v })}
          />
        </Field>
        <Field label="Button text">
          <ColorInput
            value={theme.button_text_color}
            onChange={(v) => onPatch({ button_text_color: v })}
          />
        </Field>
      </InspGroup>
      <InspGroup label="Presets">
        <div className="fs-presets">
          {presets.map((p) => (
            <button
              type="button"
              key={p.name}
              className="fs-preset"
              style={{ background: p.bg }}
              onClick={() =>
                onPatch({
                  background_color: p.bg,
                  accent_color: p.accent,
                  button_text_color: p.fg,
                })
              }
            >
              <span
                className="fs-preset-swatch"
                style={{ background: p.accent }}
              />
              <span className="fs-preset-name">{p.name}</span>
            </button>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function ColorInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="bs-color-row">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="bs-input mono sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ─── Inspector: Branding ──────────────────────────────────────────
function InspectorBranding({
  branding,
  onPatch,
}: {
  branding: FormConfig['branding']
  onPatch: (p: Partial<FormConfig['branding']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="image" title="Branding" sub="Logo at the top of the page" />
      <InspGroup label="Logo URL">
        <input
          type="url"
          className="bs-input mono"
          value={branding.logo_url ?? ''}
          onChange={(e) =>
            onPatch({ logo_url: e.target.value || undefined })
          }
          placeholder="https://example.com/logo.png"
        />
        <span className="bs-field-hint">PNG or SVG, ideally square.</span>
      </InspGroup>
    </div>
  )
}

// ─── Inspector: Submit & confirm ──────────────────────────────────
function InspectorSubmit({
  buttonLabel,
  onButtonLabel,
  successMessage,
  onSuccessMessage,
}: {
  buttonLabel: string
  onButtonLabel: (v: string) => void
  successMessage: string
  onSuccessMessage: (v: string) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead
        icon="check"
        title="Submit & confirmation"
        sub="What happens at the bottom of the form"
      />
      <InspGroup label="Button label">
        <input
          className="bs-input"
          value={buttonLabel}
          onChange={(e) => onButtonLabel(e.target.value)}
          maxLength={60}
        />
        <span className="bs-field-hint">{buttonLabel.length}/60</span>
      </InspGroup>
      <InspGroup label="Success message">
        <textarea
          className="bs-textarea"
          rows={3}
          value={successMessage}
          onChange={(e) => onSuccessMessage(e.target.value)}
          maxLength={400}
        />
        <span className="bs-field-hint">
          {successMessage.length}/400 · Shown after submit
        </span>
      </InspGroup>
    </div>
  )
}

// ─── Inspector: Pipeline ──────────────────────────────────────────
function InspectorPipeline({
  page,
  stages,
}: {
  page: ActionPageRow
  stages: PipelineStageOption[]
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="pipeline" title="Pipeline" sub="Where leads land on submit" />
      <InspGroup
        label={
          <>
            <Icon name="branch" size={11} /> Stage moves on each outcome
          </>
        }
      >
        <PipelineRulesEditor
          initial={page.pipeline_rules}
          stages={stages}
          kind={page.kind}
        />
      </InspGroup>
    </div>
  )
}

// ─── Inspector: Conversion ────────────────────────────────────────
function InspectorConversion({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="bs-insp">
      <InspectorHead
        icon="target"
        title="Conversion event"
        sub="What gets reported to Meta on submit"
      />
      <InspGroup label="CAPI event">
        <select
          name="capi_event_name_override"
          defaultValue={defaultValue}
          className="bs-select"
        >
          <option value="">Use default (LeadSubmitted)</option>
          {CAPI_EVENT_OPTIONS.map((ev) => (
            <option key={ev} value={ev}>
              {ev === 'SKIP' ? "Don't send" : ev}
            </option>
          ))}
        </select>
        <span className="bs-field-hint">
          Which Meta CAPI event fires when a submission is received.
        </span>
      </InspGroup>
    </div>
  )
}

// ─── Inspector: Echo ──────────────────────────────────────────────
function InspectorEcho({ page }: { page: ActionPageRow }) {
  return (
    <div className="bs-insp">
      <InspectorHead
        icon="message"
        title="Messenger echo"
        sub="Auto-reply right after submit"
      />
      <div className="bs-group">
        <EchoTemplateField
          name="notification_text"
          kind={page.kind}
          customKeys={extractCustomKeysFromConfig(page.kind, page.config)}
          defaultValue={page.notification_template?.text ?? ''}
          rows={4}
          placeholder="Thanks {first_name}! We got your details and will be in touch."
        />
      </div>
    </div>
  )
}

// ─── Inspector: Share ─────────────────────────────────────────────
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
      <InspectorHead
        icon="share"
        title="Share & embed"
        sub="How the page reaches respondents"
      />
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

// ─── Icons ────────────────────────────────────────────────────────
type IconName =
  | 'grip' | 'plus' | 'x' | 'check' | 'chevDown' | 'chevRight' | 'chevLeft'
  | 'arrowRight' | 'eye' | 'settings' | 'sliders' | 'form' | 'pipeline'
  | 'message' | 'target' | 'share' | 'sparkle' | 'bolt' | 'bot' | 'layers'
  | 'list' | 'image' | 'phone' | 'branch' | 'text' | 'radio' | 'mail' | 'cmd'
  | 'info'

function Icon({
  name,
  size = 14,
  color = 'currentColor',
  style,
}: {
  name: IconName
  size?: number
  color?: string
  style?: React.CSSProperties
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
    text: (<path d="M5 5h14M12 5v14M9 19h6" />),
    radio: (<g><circle cx="6" cy="12" r="2" /><path d="M11 12h10" /><circle cx="6" cy="6" r="2" /><path d="M11 6h10" /><circle cx="6" cy="18" r="2" /><path d="M11 18h10" /></g>),
    mail: (<g><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></g>),
    cmd: (<path d="M9 3a3 3 0 010 6H6a3 3 0 010-6 3 3 0 013 3v12a3 3 0 003 3 3 3 0 003-3v-3a3 3 0 016 0 3 3 0 01-3 3h-3M15 9h-3" />),
    info: (<g><circle cx="12" cy="12" r="9" /><path d="M12 8h0M11 12h1v5h1" /></g>),
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
      style={{ flexShrink: 0, ...style }}
      aria-hidden
    >
      {p[name]}
    </svg>
  )
}

// ─── Styles ───────────────────────────────────────────────────────
function FormStudioStyles() {
  return (
    <style>{`
/* Reuse the booking-studio chrome-hide so the sidebar/topbar disappear. */
body[data-booking-studio] .ws-sidebar { display: none !important; }
body[data-booking-studio] .ws-topbar { display: none !important; }
body[data-booking-studio] .ws-main { padding: 0 !important; }

[data-booking-studio][data-form-studio] {
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
[data-booking-studio][data-form-studio] * { box-sizing:border-box; }
[data-booking-studio][data-form-studio] .bs-form { display:flex; flex-direction:column; flex:1; min-height:0; }
[data-booking-studio][data-form-studio] button { font:inherit; color:inherit; cursor:pointer; border:0; background:0; padding:0; }
[data-booking-studio][data-form-studio] input,
[data-booking-studio][data-form-studio] textarea,
[data-booking-studio][data-form-studio] select { font:inherit; color:inherit; }
[data-booking-studio][data-form-studio] .mono { font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace; }

[data-form-studio] .bs-topbar {
  display:flex; align-items:center; gap:10px; height:48px;
  padding:0 14px; background:var(--bs-paper-2);
  border-bottom:1px solid var(--bs-border); flex-wrap:wrap;
}
[data-form-studio] .bs-back {
  display:inline-flex; align-items:center; gap:4px;
  text-decoration:none; color:var(--bs-ink-3); font-weight:500; font-size:12.5px;
  padding:5px 8px 5px 4px; border-radius:6px;
}
[data-form-studio] .bs-back:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-form-studio] .bs-sep { color:var(--bs-ink-5); }
[data-form-studio] .bs-crumbs { display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--bs-ink-3); }
[data-form-studio] .bs-crumb-muted { color:var(--bs-ink-3); }
[data-form-studio] .bs-crumb-cur { color:var(--bs-ink); font-weight:500; }
[data-form-studio] .bs-spacer { flex:1; }
[data-form-studio] .bs-pill {
  display:inline-flex; align-items:center; gap:5px;
  height:20px; padding:0 8px; border-radius:10px;
  background:var(--bs-bg-2); color:var(--bs-ink-3);
  font-size:11px; font-weight:500; border:1px solid var(--bs-border);
  margin-left:6px;
}
[data-form-studio] .bs-pill .bs-pill-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-form-studio] .bs-pill.live { background:var(--bs-green-soft); color:#2f5a35; border-color:#c6d4bc; }
[data-form-studio] .bs-pill.live .bs-pill-dot { background:var(--bs-green); }
[data-form-studio] .bs-pill.draft { background:var(--bs-amber-soft); color:#7a5b07; border-color:#e3d29a; }
[data-form-studio] .bs-pill.draft .bs-pill-dot { background:var(--bs-amber); }
[data-form-studio] .bs-pill.accent { background:var(--bs-accent-ghost); color:var(--bs-accent-2); border-color:#ecd4c6; height:16px; padding:0 6px; font-size:10px; }

[data-form-studio] .bs-btn {
  display:inline-flex; align-items:center; gap:5px;
  height:28px; padding:0 10px; border-radius:6px;
  font-size:12.5px; font-weight:500;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  color:var(--bs-ink); box-shadow:var(--bs-shadow-1); text-decoration:none;
}
[data-form-studio] .bs-btn:hover { background:var(--bs-bg-2); }
[data-form-studio] .bs-btn.sm { height:24px; padding:0 8px; font-size:12px; }
[data-form-studio] .bs-btn-ghost { background:transparent; border-color:transparent; box-shadow:none; color:var(--bs-ink-2); }
[data-form-studio] .bs-btn-ghost:hover { background:var(--bs-bg-2); }
[data-form-studio] .bs-btn-primary { background:var(--bs-accent); color:#fff; border-color:var(--bs-accent-2); }
[data-form-studio] .bs-btn-primary:hover { background:var(--bs-accent-2); }
[data-form-studio] .bs-btn-primary:disabled { opacity:.7; cursor:not-allowed; }
[data-form-studio] .bs-btn-danger { background:var(--bs-paper); color:var(--bs-danger); border-color:#e8c9c7; }
[data-form-studio] .bs-btn-danger:hover { background:#faf0f0; }

[data-form-studio] .bs-banner { margin:10px 14px 0; padding:8px 12px; border-radius:6px; font-size:12.5px; }
[data-form-studio] .bs-banner.success { background:var(--bs-green-soft); color:#2f5a35; border:1px solid #c6d4bc; }
[data-form-studio] .bs-banner.error { background:#faecea; color:#8a3a36; border:1px solid #e8c9c7; }

[data-form-studio] .bs-shell {
  display:grid; grid-template-columns:264px 1fr 360px;
  flex:1; min-height:0;
}
[data-form-studio] .bs-pane { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
[data-form-studio] .bs-left { background:var(--bs-bg-2); border-right:1px solid var(--bs-border); overflow-y:auto; }
[data-form-studio] .bs-center { background:#FAFAF7; }
[data-form-studio] .bs-right { background:var(--bs-paper-2); border-left:1px solid var(--bs-border); overflow-y:auto; }

[data-form-studio] .bs-section { padding:14px; border-bottom:1px solid var(--bs-border-soft); }
[data-form-studio] .bs-seclabel {
  display:flex; align-items:center; justify-content:space-between;
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.7px;
  color:var(--bs-ink-3); margin-bottom:8px;
}
[data-form-studio] .bs-seclabel.mt { margin-top:14px; }
[data-form-studio] .bs-seclabel > span:first-child { display:inline-flex; align-items:center; gap:6px; }
[data-form-studio] .fs-count { font-weight:500; color:var(--bs-ink-4); }

[data-form-studio] .fs-cta-row { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
[data-form-studio] .fs-cta-label { font-size:10px; font-weight:600; color:var(--bs-ink-4); letter-spacing:.4px; text-transform:uppercase; }
[data-form-studio] .fs-cta-input {
  flex:1; height:24px; padding:0 8px; border-radius:6px;
  background:var(--bs-bg-2); border:1px solid var(--bs-border);
  font-size:12px; color:var(--bs-ink-2); outline:none;
}
[data-form-studio] .fs-cta-input:focus { border-color:var(--bs-accent); background:var(--bs-paper); }

[data-form-studio] .bs-trigger-box { background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:8px; padding:8px 10px; }
[data-form-studio] .bs-trigger-help { font-size:11px; color:var(--bs-ink-4); margin-bottom:6px; }
[data-form-studio] .bs-trigger-textarea {
  width:100%; min-height:64px; resize:vertical;
  background:var(--bs-accent-ghost); border:1px dashed #e5c8b8;
  border-radius:5px; padding:7px 9px;
  font-size:12.5px; line-height:1.45; color:var(--bs-ink); font-family:inherit;
}
[data-form-studio] .bs-trigger-textarea:focus { outline:none; border-color:var(--bs-accent); }

[data-form-studio] .bs-rows { display:flex; flex-direction:column; gap:1px; }
[data-form-studio] .bs-row {
  display:flex; align-items:center; gap:8px;
  padding:7px 8px; border-radius:6px; position:relative;
  background:transparent; text-align:left; width:100%;
  transition:background .12s;
}
[data-form-studio] .bs-row:hover { background:rgba(60,50,30,.04); }
[data-form-studio] .bs-row.sel { background:var(--bs-paper); box-shadow:var(--bs-shadow-1), 0 0 0 1px var(--bs-border); }
[data-form-studio] .bs-row .bs-row-rail { position:absolute; left:-14px; top:6px; bottom:6px; width:2px; background:transparent; border-radius:2px; }
[data-form-studio] .bs-row.sel .bs-row-rail { background:var(--bs-accent); }
[data-form-studio] .bs-row-meta { flex:1; min-width:0; }
[data-form-studio] .bs-row-label { display:block; font-size:12.5px; font-weight:500; color:var(--bs-ink); line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
[data-form-studio] .bs-row.sel .bs-row-label { font-weight:600; }
[data-form-studio] .bs-row-sub { display:block; font-size:11px; color:var(--bs-ink-4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

[data-form-studio] .fs-row-icon {
  width:18px; height:18px; border-radius:4px; flex-shrink:0;
  background:var(--bs-bg-3); color:var(--bs-ink-3);
  display:inline-flex; align-items:center; justify-content:center;
}
[data-form-studio] .bs-row.sel .fs-row-icon { background:var(--bs-accent-ghost); color:var(--bs-accent-2); }

[data-form-studio] .fs-addsplit { display:flex; gap:4px; margin-top:8px; }
[data-form-studio] .fs-addbtn {
  flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px;
  height:26px; font-size:11px; font-weight:500; color:var(--bs-ink-3);
  background:var(--bs-paper); border:1px dashed var(--bs-border-strong); border-radius:5px;
}
[data-form-studio] .fs-addbtn:hover { border-color:var(--bs-accent); color:var(--bs-accent-2); }

[data-form-studio] .bs-leftfoot { padding:10px 14px; border-top:1px solid var(--bs-border-soft); background:var(--bs-bg-3); position:sticky; bottom:0; }
[data-form-studio] .bs-leftfoot-row { display:flex; justify-content:space-between; font-size:11px; color:var(--bs-ink-3); gap:8px; }

[data-form-studio] .bs-canvas-toolbar {
  display:flex; align-items:center; gap:8px;
  padding:10px 14px; font-size:11.5px; color:var(--bs-ink-4);
  border-bottom:1px solid var(--bs-border-soft); background:var(--bs-paper-2);
}
[data-form-studio] .bs-mute { color:var(--bs-ink-4); }
[data-form-studio] .bs-canvas-full { flex:1; min-height:0; overflow-y:auto; background:#FAFAF7; }
[data-form-studio] .fs-canvas {
  background:#FAFAF7;
  background-image: radial-gradient(circle at 1px 1px, rgba(60,50,30,.08) 1px, transparent 1px);
  background-size: 20px 20px;
  padding: 24px 0 40px;
}

[data-form-studio] .bs-insp { display:flex; flex-direction:column; }
[data-form-studio] .bs-insphead {
  display:flex; align-items:flex-start; gap:10px;
  padding:14px 16px; border-bottom:1px solid var(--bs-border-soft);
  background:var(--bs-paper);
}
[data-form-studio] .bs-insphead-icon {
  width:28px; height:28px; border-radius:7px;
  background:var(--bs-accent-ghost); color:var(--bs-accent-2);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
[data-form-studio] .bs-insphead-title { font-size:13.5px; font-weight:600; letter-spacing:-.1px; }
[data-form-studio] .bs-insphead-sub { font-size:11.5px; color:var(--bs-ink-4); margin-top:1px; }
[data-form-studio] .bs-group { padding:12px 16px; border-bottom:1px solid var(--bs-border-soft); }
[data-form-studio] .bs-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
[data-form-studio] .bs-field:last-child { margin-bottom:0; }
[data-form-studio] .bs-field-label { font-size:11.5px; font-weight:500; color:var(--bs-ink-2); }
[data-form-studio] .bs-field-hint { font-size:11px; color:var(--bs-ink-4); margin-top:2px; }
[data-form-studio] .bs-help { font-size:11.5px; color:var(--bs-ink-3); line-height:1.5; margin:0 0 10px; }

[data-form-studio] .bs-input, [data-form-studio] .bs-textarea, [data-form-studio] .bs-select {
  width:100%; background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:5px; padding:6px 8px; font-size:12.5px; color:var(--bs-ink); height:28px;
}
[data-form-studio] .bs-input.sm { height:24px; font-size:12px; }
[data-form-studio] .bs-textarea { height:auto; min-height:60px; resize:vertical; font-family:inherit; line-height:1.45; padding:8px 10px; }
[data-form-studio] .bs-select { padding-right:24px; }
[data-form-studio] .bs-input:focus, [data-form-studio] .bs-textarea:focus, [data-form-studio] .bs-select:focus {
  outline:none; border-color:var(--bs-accent); box-shadow:0 0 0 3px var(--bs-accent-ghost);
}
[data-form-studio] .bs-input.mono { font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace; }

[data-form-studio] .bs-input-affix {
  display:flex; align-items:center; background:var(--bs-paper);
  border:1px solid var(--bs-border-strong); border-radius:5px; overflow:hidden;
}
[data-form-studio] .bs-input-affix .bs-prefix {
  padding:0 8px; font-size:12px; color:var(--bs-ink-4); background:var(--bs-bg-2);
  height:28px; display:inline-flex; align-items:center; border-right:1px solid var(--bs-border-strong);
  font-family: ui-monospace,Menlo,monospace;
}
[data-form-studio] .bs-input-affix input { flex:1; border:0; padding:0 8px; height:28px; background:transparent; outline:none; font-size:12.5px; }

[data-form-studio] .bs-segment { display:inline-flex; background:var(--bs-bg-2); border-radius:6px; padding:2px; gap:1px; }
[data-form-studio] .bs-segbtn {
  height:22px; padding:0 9px; border-radius:5px;
  font-size:11.5px; font-weight:500; color:var(--bs-ink-3);
  display:inline-flex; align-items:center; gap:5px;
}
[data-form-studio] .bs-segbtn.on { background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1); }
[data-form-studio] .bs-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-form-studio] .bs-dot.draft { background:var(--bs-amber); }
[data-form-studio] .bs-dot.published { background:var(--bs-green); }
[data-form-studio] .bs-dot.archived { background:var(--bs-ink-4); }

[data-form-studio] .bs-link {
  display:inline-flex; align-items:center; gap:4px;
  font-size:11.5px; font-weight:500; color:var(--bs-accent-2);
}
[data-form-studio] .bs-link:hover { color:var(--bs-accent); }

[data-form-studio] .bs-check { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:var(--bs-ink-2); cursor:pointer; }
[data-form-studio] .fs-required-row { padding:4px 0; }

[data-form-studio] .bs-iconbtn {
  display:inline-flex; align-items:center; justify-content:center;
  width:24px; height:24px; border-radius:4px; color:var(--bs-ink-4);
}
[data-form-studio] .bs-iconbtn:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-form-studio] .bs-iconbtn.danger:hover { background:#faecea; color:var(--bs-danger); }

[data-form-studio] .bs-empty-state {
  display:flex; flex-direction:column; align-items:center; gap:8px;
  padding:18px 12px; border:1px dashed var(--bs-border-strong); border-radius:8px;
  color:var(--bs-ink-4); font-size:12px; text-align:center; background:var(--bs-paper);
}

[data-form-studio] .bs-color-row { display:flex; gap:6px; align-items:center; }
[data-form-studio] .bs-color-row input[type="color"] {
  width:32px; height:28px; border:1px solid var(--bs-border-strong);
  border-radius:5px; padding:0; cursor:pointer; background:var(--bs-paper);
}

[data-form-studio] .fs-presets { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
[data-form-studio] .fs-preset {
  padding:8px; border-radius:6px; border:1px solid var(--bs-border);
  display:flex; flex-direction:column; gap:6px; text-align:left;
}
[data-form-studio] .fs-preset:hover { border-color:var(--bs-accent); }
[data-form-studio] .fs-preset-swatch { display:block; height:18px; border-radius:3px; }
[data-form-studio] .fs-preset-name { font-size:10.5px; color:var(--bs-ink-3); }

[data-form-studio] .fs-options { display:flex; flex-direction:column; gap:1px; background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:6px; overflow:hidden; }
[data-form-studio] .fs-option-row {
  display:grid; grid-template-columns:16px 1fr 1fr 24px;
  gap:6px; align-items:center; padding:6px 8px;
  border-bottom:1px solid var(--bs-border-soft);
}
[data-form-studio] .fs-option-row:last-child { border-bottom:0; }
[data-form-studio] .fs-option-grip { color:var(--bs-ink-5); display:inline-flex; align-items:center; justify-content:center; cursor:grab; }
[data-form-studio] .fs-option-label, [data-form-studio] .fs-option-value {
  background:transparent; border:0; outline:none; padding:2px 4px;
  font-size:12.5px; color:var(--bs-ink); width:100%;
}
[data-form-studio] .fs-option-value { background:var(--bs-bg-2); border-radius:3px; font-size:11.5px; color:var(--bs-ink-3); }

[data-form-studio] .fs-action-row { display:flex; gap:6px; flex-wrap:wrap; }
[data-form-studio] .fs-action-row .bs-btn { flex:1; min-width:0; }
[data-form-studio] .fs-remove {
  display:block; margin-top:10px; width:100%; padding:7px 8px;
  border-radius:5px; color:var(--bs-danger); background:transparent;
  font-size:12px; font-weight:500; border:1px solid transparent;
}
[data-form-studio] .fs-remove:hover { background:rgba(184,84,80,.08); }

/* ── FormStudioPreview themed card ────────────────────────── */
[data-form-studio] .fp-stage {
  display:flex; flex-direction:column; align-items:center; gap:14px;
}
[data-form-studio] .fp-card {
  width:380px; background:var(--fp-bg, #fff);
  color:#1a1a1a; border-radius:14px; overflow:hidden;
  box-shadow:0 1px 2px rgba(0,0,0,.05), 0 8px 28px rgba(60,50,30,.10);
  border:1px solid var(--bs-border);
  font-size:13px; padding-bottom:18px;
}
[data-form-studio] .fp-block { padding:6px 18px; position:relative; }
[data-form-studio] .fp-block.inline { padding:4px 18px; }
[data-form-studio] .fp-block.sel { outline:2px solid var(--fp-accent, var(--bs-accent)); outline-offset:-2px; border-radius:4px; }
[data-form-studio] .fp-branding { display:flex; align-items:center; gap:8px; padding:8px 0 4px; }
[data-form-studio] .fp-mark {
  width:24px; height:24px; border-radius:12px;
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:700;
}
[data-form-studio] .fp-wordmark { font-size:13px; font-weight:600; letter-spacing:-.2px; }
[data-form-studio] .fp-title {
  margin:6px 0 0; font-size:22px; font-weight:600; letter-spacing:-.4px;
  line-height:1.2; font-family:'Tiempos Text','Source Serif Pro',Charter,Georgia,serif;
}
[data-form-studio] .fp-desc { margin:6px 0 0; font-size:12.5px; line-height:1.5; opacity:.75; }
[data-form-studio] .fp-heading { margin:8px 0 0; font-weight:600; letter-spacing:-.3px; }
[data-form-studio] .fp-heading-1 { font-size:20px; }
[data-form-studio] .fp-heading-2 { font-size:16px; }
[data-form-studio] .fp-heading-3 { font-size:14px; }
[data-form-studio] .fp-fields {
  padding:4px 18px 6px; display:flex; flex-direction:column; gap:9px;
}
[data-form-studio] .fp-fields .fp-block { padding:6px 0; }
[data-form-studio] .fp-fields .fp-block.sel { padding:6px 4px; margin:-0 -4px; outline-offset:0; }
[data-form-studio] .fp-flabel { font-size:11.5px; font-weight:500; margin-bottom:4px; display:flex; align-items:center; gap:4px; }
[data-form-studio] .fp-req { font-weight:600; }
[data-form-studio] .fp-input {
  padding:8px 10px; border-radius:6px; background:#fff;
  border:1px solid rgba(0,0,0,.08); font-size:12px; color:#a59f8e; min-height:16px;
}
[data-form-studio] .fp-input.fp-textarea { min-height:38px; }
[data-form-studio] .fp-input.fp-select { display:flex; justify-content:space-between; align-items:center; color:#2a2620; }
[data-form-studio] .fp-chev { font-size:10px; color:#8c8675; }
[data-form-studio] .fp-radios { display:flex; flex-direction:column; gap:5px; }
[data-form-studio] .fp-radio-row { display:flex; align-items:center; gap:8px; font-size:12px; }
[data-form-studio] .fp-radio {
  width:13px; height:13px; border-radius:7px; border:1.5px solid rgba(0,0,0,.2);
  background:#fff; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
}
[data-form-studio] .fp-radio-dot { width:6px; height:6px; border-radius:3px; }
[data-form-studio] .fp-check-row { display:flex; align-items:center; gap:8px; font-size:12px; padding:6px 0; }
[data-form-studio] .fp-check { width:13px; height:13px; border-radius:3px; border:1.5px solid rgba(0,0,0,.2); background:#fff; flex-shrink:0; }
[data-form-studio] .fp-submit {
  width:calc(100% - 36px); margin:6px 18px 0; padding:11px 14px; border-radius:8px;
  font-weight:600; font-size:13px; letter-spacing:-.1px;
  box-shadow:0 1px 0 rgba(0,0,0,.05); border:0; cursor:pointer;
}
[data-form-studio] .fp-foot {
  display:inline-flex; align-items:center; gap:6px;
  font-size:11px; color:var(--bs-ink-4);
}

/* ── Danger zone ─────────────────────────────────────────── */
[data-form-studio] .bs-danger {
  margin:16px 14px; padding:14px 16px;
  background:var(--bs-paper); border:1px solid #e8c9c7;
  border-radius:8px;
  display:flex; align-items:center; justify-content:space-between; gap:12px;
}
[data-form-studio] .bs-danger h3 { margin:0; font-size:13px; font-weight:600; color:var(--bs-danger); }
[data-form-studio] .bs-danger p { margin:2px 0 0; font-size:11.5px; color:var(--bs-ink-3); }

[data-form-studio] .bs-mobile-tabs { display:none; }
@media (max-width: 960px) {
  [data-form-studio] .bs-shell { grid-template-columns: 1fr; }
  [data-form-studio] .bs-pane { display:none; }
  [data-form-studio] .bs-pane.mobile-active { display:flex; }
  [data-form-studio] .bs-left, [data-form-studio] .bs-right { border:0; }
  [data-form-studio] .bs-mobile-tabs {
    display:flex; gap:4px; padding:8px 12px;
    background:var(--bs-paper-2); border-bottom:1px solid var(--bs-border);
  }
  [data-form-studio] .bs-mobile-tab {
    flex:1; padding:8px 0; border-radius:6px;
    font-size:12.5px; font-weight:500; color:var(--bs-ink-3);
    background:var(--bs-bg-2);
  }
  [data-form-studio] .bs-mobile-tab.active { background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1); }
}
    `}</style>
  )
}
