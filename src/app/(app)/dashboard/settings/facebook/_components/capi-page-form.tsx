'use client'

import { useState } from 'react'
import { saveCapiConfigForm, sendCapiTestEventForm } from '../actions'

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiPageForm({ page }: { page: Page }) {
  const [editingToken, setEditingToken] = useState(!page.has_capi_token)

  return (
    <details
      className="rounded-md border p-4 open:bg-muted/30"
      open={page.capi_enabled || !page.has_capi_token}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {page.name} {page.capi_enabled ? '· Enabled' : '· Disabled'}
      </summary>
      <form action={saveCapiConfigForm} className="mt-4 space-y-3">
        <input type="hidden" name="page_id" value={page.id} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="capi_enabled" defaultChecked={page.capi_enabled} />
          Enabled
        </label>
        <label className="block text-sm">
          <span className="block mb-1">Dataset ID (Pixel ID)</span>
          <input
            type="text"
            name="capi_dataset_id"
            defaultValue={page.capi_dataset_id ?? ''}
            placeholder="1234567890"
            className="w-full border rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1">CAPI Access Token</span>
          {editingToken ? (
            <input
              type="password"
              name="capi_access_token"
              placeholder={page.has_capi_token ? 'Leave blank to keep current' : 'Paste token from Events Manager'}
              className="w-full border rounded px-2 py-1"
              autoComplete="off"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">••••••••••••</span>
              <button
                type="button"
                onClick={() => setEditingToken(true)}
                className="text-xs underline"
              >
                Edit
              </button>
              <input type="hidden" name="token_unchanged" value="1" />
            </div>
          )}
        </label>
        <label className="block text-sm">
          <span className="block mb-1">Test Event Code (optional)</span>
          <input
            type="text"
            name="capi_test_event_code"
            defaultValue={page.capi_test_event_code ?? ''}
            placeholder="TEST12345"
            className="w-full border rounded px-2 py-1"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded bg-emerald-600 text-white text-sm px-3 py-1.5"
          >
            Save
          </button>
          <button
            type="submit"
            formAction={sendCapiTestEventForm}
            className="rounded border text-sm px-3 py-1.5"
            disabled={!page.capi_enabled}
            title={page.capi_enabled ? 'Send a synthetic Lead event' : 'Enable CAPI first'}
          >
            Send test event
          </button>
        </div>
      </form>
    </details>
  )
}
