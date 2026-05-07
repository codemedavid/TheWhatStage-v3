'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'

export type MediaMentionItem =
  | {
      kind: 'asset'
      id: string
      slug: string
      name: string
      url: string | null
      folderName: string | null
    }
  | {
      kind: 'folder'
      id: string
      slug: string
      name: string
      assetCount: number
    }
  | {
      kind: 'action_page'
      id: string
      slug: string
      name: string
      ctaLabel: string
    }

export interface MediaMentionListProps {
  items: MediaMentionItem[]
  command: (item: MediaMentionItem) => void
  query: string
}

export interface MediaMentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export const MediaMentionList = forwardRef<MediaMentionListHandle, MediaMentionListProps>(
  function MediaMentionList({ items, command, query }, ref) {
    const [index, setIndex] = useState(0)

    useEffect(() => setIndex(0), [items])

    useImperativeHandle(ref, () => ({
      onKeyDown(event) {
        if (items.length === 0) return false
        if (event.key === 'ArrowDown') {
          setIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setIndex((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[index]
          if (item) command(item)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="media-mention-popover">
          <div className="media-mention-empty">
            No matches for {query ? `"${query}"` : 'this query'}
          </div>
        </div>
      )
    }

    return (
      <div className="media-mention-popover" role="listbox">
        {items.map((item, i) => (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setIndex(i)}
            onClick={() => command(item)}
            className={`media-mention-row${i === index ? ' is-active' : ''}`}
          >
            <div className="media-mention-thumb">
              {item.kind === 'asset' && item.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.name} loading="lazy" />
              ) : item.kind === 'folder' ? (
                <span className="media-mention-folder-glyph" aria-hidden>
                  #
                </span>
              ) : item.kind === 'action_page' ? (
                <span className="media-mention-folder-glyph" aria-hidden>
                  !
                </span>
              ) : (
                <span className="media-mention-folder-glyph" aria-hidden>
                  @
                </span>
              )}
            </div>
            <div className="media-mention-meta">
              <div className="media-mention-name">{item.name}</div>
              <div className="media-mention-sub">
                {item.kind === 'asset' ? (
                  <>
                    <code>@{item.slug}</code>
                    {item.folderName ? <span> · {item.folderName}</span> : null}
                  </>
                ) : item.kind === 'action_page' ? (
                  <>
                    <code>!actionpage:{item.slug}</code>
                    {item.ctaLabel ? <span> · {item.ctaLabel}</span> : null}
                  </>
                ) : (
                  <>
                    <code>#{item.slug}</code>
                    <span> · {item.assetCount} {item.assetCount === 1 ? 'image' : 'images'}</span>
                  </>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    )
  },
)
