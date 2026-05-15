'use client'

import { useEffect, useRef, useState } from 'react'
import type { ActionPageRow } from '../_lib/queries'

type Status = ActionPageRow['status']

/**
 * Intercepts Save clicks so that whenever the page status is still `draft`,
 * the operator is prompted to either publish (Make Live) or save as-is
 * (Keep Draft). Fires on every save while in draft — by design, per product.
 *
 * Wire-up in a shell:
 *   const gate = useDraftGate({ status, setStatus })
 *   <button type="button" onClick={(e) => gate.requestSave(e.currentTarget.form)} />
 *   <DraftSaveModal {...gate.modalProps} />
 */
export function useDraftGate({
  status,
  setStatus,
}: {
  status: Status
  setStatus: (s: Status) => void
}) {
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement | null>(null)
  // Two-phase submit when the user chose "Make Live": first flip status to
  // 'published' (so the hidden <input name="status"> re-renders with the new
  // value), then requestSubmit() once the effect sees the published status.
  const [pendingLiveSubmit, setPendingLiveSubmit] = useState(false)

  useEffect(() => {
    if (pendingLiveSubmit && status === 'published') {
      formRef.current?.requestSubmit()
      setPendingLiveSubmit(false)
    }
  }, [pendingLiveSubmit, status])

  function requestSave(form: HTMLFormElement | null) {
    if (!form) return
    formRef.current = form
    if (status === 'draft') {
      setOpen(true)
      return
    }
    form.requestSubmit()
  }

  function keepDraft() {
    setOpen(false)
    formRef.current?.requestSubmit()
  }

  function makeLive() {
    setOpen(false)
    setStatus('published')
    setPendingLiveSubmit(true)
  }

  return {
    requestSave,
    modalProps: {
      open,
      onClose: () => setOpen(false),
      onMakeLive: makeLive,
      onKeepDraft: keepDraft,
    },
  }
}
