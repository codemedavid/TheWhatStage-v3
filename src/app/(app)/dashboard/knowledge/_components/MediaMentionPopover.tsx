'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mediaMentionBus } from './mediaMentionExtension'
import {
  MediaMentionList,
  type MediaMentionItem,
  type MediaMentionListHandle,
} from './MediaMentionList'

/**
 * Listens to the suggestion bus and renders the popover floating above/below
 * the trigger character. Lives anywhere in the React tree — it portals to
 * `document.body` so positioning isn't affected by parent overflow.
 */
export function MediaMentionPopover() {
  const [state, setState] = useState(mediaMentionBus.state)
  const listRef = useRef<MediaMentionListHandle>(null)

  useEffect(() => mediaMentionBus.subscribe(setState), [])

  useEffect(() => {
    mediaMentionBus.setKeyHandler((event) => {
      if (!state.open) return false
      return listRef.current?.onKeyDown(event) ?? false
    })
    return () => mediaMentionBus.setKeyHandler(null)
  }, [state.open])

  if (!state.open || !state.command) return null

  const margin = 6
  const popHeight = 240
  const popWidth = 280
  const rect = state.rect
  // Prefer below the caret. Flip above only if there's truly no room below.
  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0
  const flipAbove = rect != null && spaceBelow < popHeight + margin && rect.top > popHeight + margin
  const top = rect
    ? flipAbove
      ? rect.top - popHeight - margin
      : rect.bottom + margin
    : 120
  const left = rect
    ? Math.max(margin, Math.min(rect.left, window.innerWidth - popWidth - margin))
    : 120

  const command = state.command

  return createPortal(
    <div
      className="media-mention-floater"
      style={{ top: Math.max(margin, top), left: Math.max(margin, left) }}
    >
      <MediaMentionList
        ref={listRef}
        items={state.items}
        command={(item: MediaMentionItem) => command(item)}
        query={state.query}
      />
    </div>,
    document.body,
  )
}
