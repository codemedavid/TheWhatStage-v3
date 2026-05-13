'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setPrimaryActionPage } from '../../chatbot/actions'

export function PublishedPrimaryGoalBanner({
  actionPageId,
  mode,
  currentGoalTitle,
}: {
  actionPageId: string
  mode: 'offer' | 'switch'
  currentGoalTitle: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function dismiss() {
    const url = new URL(window.location.href)
    url.searchParams.delete('just_published')
    url.searchParams.delete('offer_primary')
    router.replace(url.pathname + (url.search ? url.search : ''))
  }

  function accept() {
    startTransition(async () => {
      await setPrimaryActionPage(actionPageId)
      dismiss()
    })
  }

  const heading =
    mode === 'switch'
      ? `This page is published. Replace your current primary goal${
          currentGoalTitle ? ` ("${currentGoalTitle}")` : ''
        } with this one?`
      : "This page is published. Make it your chatbot's primary goal?"

  const acceptLabel = mode === 'switch' ? 'Replace' : 'Set as primary goal'
  const dismissLabel = mode === 'switch' ? 'Keep current' : 'Not now'

  return (
    <div className="ap-banner ap-banner-info" role="status">
      <p>{heading}</p>
      <div className="ap-banner-actions">
        <button type="button" onClick={accept} disabled={pending}>
          {acceptLabel}
        </button>
        <button type="button" onClick={dismiss} disabled={pending}>
          {dismissLabel}
        </button>
      </div>
    </div>
  )
}
