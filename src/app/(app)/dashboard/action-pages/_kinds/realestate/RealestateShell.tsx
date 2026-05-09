'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { updateActionPage, deleteActionPage } from '../../actions/crud'
import type { ActionPageRow } from '../../_lib/queries'
import { CopyField } from '../../_components/CopyField'
import { PipelineRulesEditor } from '../../_components/PipelineRulesEditor'
import { TriggerGuard } from '../../_components/TriggerGuard'
import RealEstateEditor from './Editor'

export function RealestateShell({
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
  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description ?? '')
  const [slug, setSlug] = useState(page.slug)
  const [status, setStatus] = useState<ActionPageRow['status']>(page.status)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'workflow' | 'share'>('general')

  useEffect(() => {
    if (settingsOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [settingsOpen])

  const statusLabel =
    status === 'draft' ? 'Draft' : status === 'published' ? 'Live' : 'Archived'
  const statusTone =
    status === 'published'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'archived'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-zinc-100 text-zinc-700 ring-zinc-200'

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <form
        action={deleteActionPage}
        id="realestate-delete-form"
        className="hidden"
      >
        <input type="hidden" name="id" value={page.id} />
      </form>
      <form action={updateActionPage} className="flex min-h-screen flex-col">
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="status" value={status} />

        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-5">
            <TriggerGuard
              pageId={page.id}
              initialTrigger={page.bot_send_instructions}
              backHref="/dashboard/action-pages"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              onJumpToTrigger={() => {
                setSettingsTab('workflow')
                setSettingsOpen(true)
              }}
            >
              <ChevronLeft /> Back
            </TriggerGuard>

            <div className="mx-1 h-5 w-px bg-zinc-200" />

            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                maxLength={120}
                placeholder="Listing page name"
                className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-[15px] font-semibold text-zinc-900 outline-none transition focus:bg-zinc-50 focus:ring-1 focus:ring-emerald-500"
              />
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${statusTone}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {statusLabel}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 sm:inline-flex"
              >
                <ExternalIcon /> View
              </a>
              <Link
                href={`/dashboard/action-pages/${page.id}/submissions`}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <InboxIcon /> Submissions
              </Link>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <GearIcon /> Settings
              </button>
              <SaveButton />
            </div>
          </div>
        </header>

        {(saved || errorBanner) && (
          <div className="mx-auto w-full max-w-7xl px-5 pt-4">
            {saved && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                Saved.
              </div>
            )}
            {errorBanner && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {errorBanner}
              </div>
            )}
          </div>
        )}

        <div className="mx-auto w-full max-w-7xl px-5 pt-6">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-zinc-500">
                Property Listings
              </div>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-zinc-900">
                Manage your listings
              </h1>
              <p className="mt-1 text-[13px] text-zinc-600">
                Add properties, group them, and customize how leads see your
                public listing page.
              </p>
            </div>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50 md:inline-flex"
            >
              <span className="font-mono text-[11.5px] text-zinc-500">
                /a/{slug}
              </span>
              <ExternalIcon />
            </a>
          </div>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">
          <RealEstateEditor page={page} />
        </main>

        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          page={page}
          stages={stages}
          publicUrl={publicUrl}
          embedUrl={embedUrl}
          embedSnippet={embedSnippet}
          slug={slug}
          status={status}
          description={description}
          onSlug={setSlug}
          onStatus={setStatus}
          onDescription={setDescription}
          tab={settingsTab}
          onTabChange={setSettingsTab}
        />
      </form>
    </div>
  )
}

function SettingsDrawer({
  open,
  onClose,
  page,
  stages,
  publicUrl,
  embedUrl,
  embedSnippet,
  slug,
  status,
  description,
  onSlug,
  onStatus,
  onDescription,
  tab,
  onTabChange,
}: {
  open: boolean
  onClose: () => void
  page: ActionPageRow
  stages: { id: string; name: string }[]
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  slug: string
  status: ActionPageRow['status']
  description: string
  onSlug: (v: string) => void
  onStatus: (v: ActionPageRow['status']) => void
  onDescription: (v: string) => void
  tab: 'general' | 'workflow' | 'share'
  onTabChange: (t: 'general' | 'workflow' | 'share') => void
}) {

  return (
    <div className={open ? '' : 'sr-only pointer-events-none absolute'}>
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-zinc-900/40 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-zinc-200 bg-white shadow-xl transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Listings settings"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">
              Listings settings
            </h2>
            <p className="mt-0.5 text-[12.5px] text-zinc-500">
              One place for the URL, workflow, and share links.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <CloseIcon />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-zinc-200 px-3 pt-2">
          {(
            [
              { id: 'general', label: 'General' },
              { id: 'workflow', label: 'Workflow' },
              { id: 'share', label: 'Share' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`relative px-3 py-2 text-[13px] font-medium transition ${
                tab === t.id
                  ? 'text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-600" />
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className={tab === 'general' ? '' : 'hidden'}>
            <GeneralPanel
              slug={slug}
              status={status}
              description={description}
              onSlug={onSlug}
              onStatus={onStatus}
              onDescription={onDescription}
              pageId={page.id}
            />
          </div>
          <div className={tab === 'workflow' ? '' : 'hidden'}>
            <WorkflowPanel page={page} stages={stages} />
          </div>
          <div className={tab === 'share' ? '' : 'hidden'}>
            <SharePanel
              publicUrl={publicUrl}
              embedUrl={embedUrl}
              embedSnippet={embedSnippet}
            />
          </div>
        </div>
      </aside>
    </div>
  )
}

function GeneralPanel({
  slug,
  status,
  description,
  onSlug,
  onStatus,
  onDescription,
  pageId,
}: {
  slug: string
  status: ActionPageRow['status']
  description: string
  onSlug: (v: string) => void
  onStatus: (v: ActionPageRow['status']) => void
  onDescription: (v: string) => void
  pageId: string
}) {
  return (
    <div className="space-y-6">
      <Field label="URL slug" help={`Public URL: /a/${slug}`} helpMono>
        <div className="flex items-center overflow-hidden rounded-md border border-zinc-200 bg-white focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
          <span className="border-r border-zinc-200 bg-zinc-50 px-2.5 py-2 font-mono text-[12px] text-zinc-500">
            /a/
          </span>
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
            className="flex-1 bg-transparent px-3 py-2 text-[13px] outline-none"
          />
        </div>
      </Field>

      <Field
        label="Description"
        optional
        help="Shown on the listing page below the title."
      >
        <textarea
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
          rows={3}
          className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder="Tell visitors what this listing page is about."
        />
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
        <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
          {(['draft', 'published', 'archived'] as const).map((v) => {
            const active = status === v
            const label =
              v === 'draft' ? 'Draft' : v === 'published' ? 'Live' : 'Archived'
            return (
              <button
                key={v}
                type="button"
                onClick={() => onStatus(v)}
                className={`rounded px-3 py-1.5 text-[12.5px] font-medium transition ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
        <h4 className="text-[13px] font-semibold text-red-900">Danger zone</h4>
        <p className="mt-1 text-[12.5px] text-red-800/80">
          Deleting this listing page is permanent. Past submissions are kept on
          lead records.
        </p>
        <DeleteButton id={pageId} />
      </div>
    </div>
  )
}

function WorkflowPanel({
  page,
  stages,
}: {
  page: ActionPageRow
  stages: { id: string; name: string }[]
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[13.5px] font-semibold text-zinc-900">
          Pipeline rules
        </h3>
        <p className="mt-0.5 text-[12.5px] text-zinc-500">
          Where leads land in your pipeline after they submit a viewing request.
        </p>
        <div className="mt-3">
          <PipelineRulesEditor
            initial={page.pipeline_rules}
            stages={stages}
            kind={page.kind}
          />
        </div>
      </div>

      <Field
        label="Messenger reply"
        optional
        help="Plain-text confirmation sent in Messenger after a successful submission."
      >
        <textarea
          name="notification_text"
          defaultValue={page.notification_template?.text ?? ''}
          rows={3}
          maxLength={640}
          placeholder="Thanks! We got your viewing request and will be in touch shortly."
          className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </Field>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h4 className="text-[13px] font-semibold text-zinc-900">
          When should the bot send these listings?
        </h4>
        <p className="mt-0.5 text-[12.5px] text-zinc-500">
          Plain-language guidance. The bot picks at most one action page per
          reply, so be specific.
        </p>
        <div className="mt-3 space-y-3">
          <Field label="Button label">
            <input
              name="cta_label"
              defaultValue={page.cta_label ?? ''}
              maxLength={50}
              placeholder="Browse properties"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </Field>
          <Field label="Trigger">
            <textarea
              name="bot_send_instructions"
              defaultValue={page.bot_send_instructions ?? ''}
              rows={4}
              maxLength={2000}
              placeholder="Send when the lead asks about properties, listings, or wants to view a unit."
              className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

function SharePanel({
  publicUrl,
  embedUrl,
  embedSnippet,
}: {
  publicUrl: string
  embedUrl: string
  embedSnippet: string
}) {
  return (
    <div className="space-y-5">
      <Field label="Public URL">
        <CopyField value={publicUrl} label="Public URL" />
      </Field>
      <Field label="Embed URL" help="Paste into iframe-friendly sites.">
        <CopyField value={embedUrl} label="Embed URL" />
      </Field>
      <Field label="Embed snippet">
        <CopyField value={embedSnippet} label="Embed snippet" />
      </Field>
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
  children: React.ReactNode
}) {
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium text-zinc-800">
          {label}
          {optional && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
              Optional
            </span>
          )}
        </div>
      )}
      {children}
      {help && (
        <p
          className={`mt-1.5 text-[11.5px] text-zinc-500 ${
            helpMono ? 'font-mono' : ''
          }`}
        >
          {help}
        </p>
      )}
    </div>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <Spinner /> Saving…
        </>
      ) : (
        <>
          <CheckIcon /> Save
        </>
      )}
    </button>
  )
}

function DeleteButton(_: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm('Delete this listing page? This cannot be undone.')) return
        const f = document.getElementById(
          'realestate-delete-form',
        ) as HTMLFormElement | null
        f?.requestSubmit()
      }}
      className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-red-700 hover:bg-red-50"
    >
      <TrashIcon /> Delete listing page
    </button>
  )
}

function ChevronLeft() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}
function InboxIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}
function ExternalIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 4h6v6" />
      <path d="M10 14L21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}
function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  )
}
