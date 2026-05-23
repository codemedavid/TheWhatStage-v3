'use client'

import { useActionState, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  CAPI_FORM_IDLE,
  saveCapiConfigAction,
  sendCapiTestEventAction,
  type CapiFormState,
} from '../actions'

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiPageForm({ page }: { page: Page }) {
  const [open, setOpen] = useState(page.capi_enabled || !page.has_capi_token)
  const [enabled, setEnabled] = useState(page.capi_enabled)
  const [editingToken, setEditingToken] = useState(!page.has_capi_token)
  const [saveState, saveAction] = useActionState<CapiFormState, FormData>(
    saveCapiConfigAction,
    CAPI_FORM_IDLE,
  )
  const [testState, testAction] = useActionState<CapiFormState, FormData>(
    sendCapiTestEventAction,
    CAPI_FORM_IDLE,
  )

  const sectionId = useId()
  const datasetId = useId()
  const tokenId = useId()
  const testCodeId = useId()

  const statusBadge = enabled ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-[#047857]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" aria-hidden />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-medium text-[#6B7280]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" aria-hidden />
      Disabled
    </span>
  )

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={sectionId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#F9FAFB]"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[14px] font-medium text-[#111827]">{page.name}</span>
          {statusBadge}
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-[#6B7280] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div id={sectionId} className="border-t border-[#E5E7EB] px-4 py-4">
          <form action={saveAction} className="space-y-4">
            <input type="hidden" name="page_id" value={page.id} />

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium text-[#111827]">
                  Forward conversion events
                </div>
                <p className="text-[12px] text-[#6B7280]">
                  Send Lead / Purchase / Schedule events from this page&apos;s submissions to Meta.
                </p>
              </div>
              <Switch
                name="capi_enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                ariaLabel="Enable Conversions API for this page"
              />
            </div>

            <Field
              id={datasetId}
              label="Dataset ID (Pixel ID)"
              hint="Numeric ID from Events Manager → Data sources."
            >
              <input
                id={datasetId}
                type="text"
                name="capi_dataset_id"
                defaultValue={page.capi_dataset_id ?? ''}
                placeholder="1234567890"
                inputMode="numeric"
                autoComplete="off"
                className={inputClass(errorField(saveState) === 'dataset')}
              />
            </Field>

            <Field
              id={tokenId}
              label="CAPI access token"
              hint="Generated in Events Manager. Stored encrypted; never shown after saving."
            >
              {editingToken ? (
                <div className="flex gap-2">
                  <input
                    id={tokenId}
                    type="password"
                    name="capi_access_token"
                    placeholder={
                      page.has_capi_token
                        ? 'Leave blank to keep the current token'
                        : 'Paste token from Events Manager'
                    }
                    autoComplete="off"
                    className={inputClass(errorField(saveState) === 'token')}
                  />
                  {page.has_capi_token && (
                    <button
                      type="button"
                      onClick={() => setEditingToken(false)}
                      className="shrink-0 rounded-md border border-[#E5E7EB] px-3 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                  <span className="font-mono text-[12px] tracking-wider text-[#6B7280]">
                    ••••  ••••  ••••  ••••
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-[#047857]">
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Stored
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingToken(true)}
                    className="text-[12px] font-medium text-[#047857] hover:underline"
                  >
                    Replace
                  </button>
                </div>
              )}
            </Field>

            <Field
              id={testCodeId}
              label="Test event code (optional)"
              hint="Use a code from Events Manager → Test events to route events to the test stream."
            >
              <input
                id={testCodeId}
                type="text"
                name="capi_test_event_code"
                defaultValue={page.capi_test_event_code ?? ''}
                placeholder="TEST12345"
                autoComplete="off"
                className={inputClass(false)}
              />
            </Field>

            {saveState.status === 'error' && (
              <FeedbackBanner tone="error" message={saveState.message} />
            )}
            {saveState.status === 'ok' && (
              <FeedbackBanner tone="success" message={saveState.message} />
            )}

            <div className="flex items-center gap-2 pt-1">
              <SaveButton />
              <span className="text-[12px] text-[#9CA3AF]">
                Token is encrypted before it ever touches the database.
              </span>
            </div>
          </form>

          <div className="mt-5 border-t border-[#E5E7EB] pt-4">
            <form action={testAction} className="space-y-2">
              <input type="hidden" name="page_id" value={page.id} />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-[#111827]">Send a test event</div>
                  <p className="text-[12px] text-[#6B7280]">
                    Posts a synthetic Lead event using the saved config — handy to confirm Meta is
                    receiving traffic.
                  </p>
                </div>
                <TestEventButton enabledInDb={page.capi_enabled} />
              </div>
              {testState.status === 'error' && (
                <FeedbackBanner tone="error" message={testState.message} />
              )}
              {testState.status === 'ok' && (
                <FeedbackBanner tone="success" message={testState.message} />
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function errorField(state: CapiFormState): 'dataset' | 'token' | 'page' | 'general' | undefined {
  return state.status === 'error' ? state.field : undefined
}

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-md border bg-white px-3 py-2 text-[13px] text-[#111827] placeholder:text-[#9CA3AF]',
    'focus:outline-none focus:ring-2 focus:ring-offset-0',
    hasError
      ? 'border-[#FCA5A5] focus:border-[#EF4444] focus:ring-[#FECACA]'
      : 'border-[#E5E7EB] focus:border-[#10B981] focus:ring-[#D1FAE5]',
  ].join(' ')
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12px] font-medium text-[#374151]">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[#9CA3AF]">{hint}</p>}
    </div>
  )
}

function Switch({
  name,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  name: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  ariaLabel: string
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
        aria-label={ariaLabel}
      />
      <span className="h-5 w-9 rounded-full bg-[#E5E7EB] transition-colors peer-checked:bg-[#10B981] peer-focus-visible:ring-2 peer-focus-visible:ring-[#D1FAE5] peer-focus-visible:ring-offset-2" />
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </label>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-[#059669] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#047857] disabled:opacity-60"
    >
      {pending && <Spinner />}
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}

function TestEventButton({ enabledInDb }: { enabledInDb: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || !enabledInDb}
      title={
        enabledInDb
          ? 'Send a synthetic Lead event using the saved config'
          : 'Enable CAPI and save before sending a test event'
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && <Spinner />}
      {pending ? 'Sending…' : 'Send test event'}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

function FeedbackBanner({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const styles =
    tone === 'success'
      ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
      : 'border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]'
  return (
    <div className={`rounded-md border px-3 py-2 text-[12px] ${styles}`} role="status">
      {message}
    </div>
  )
}
