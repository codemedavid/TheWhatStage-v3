'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaAssetRow, MediaFolderRow } from '@/app/(app)/dashboard/media/_lib/queries'

type FolderId = string | 'all'

export interface PickedAsset {
  id: string
  name: string
  slug: string
  url: string | null
}

export interface PickedFolder {
  id: string
  name: string
  slug: string
  assetCount: number
}

export interface MediaPickerPopoverProps {
  folders: MediaFolderRow[]
  assets: MediaAssetRow[]
  onPickAsset: (asset: PickedAsset) => void
  onPickFolder: (folder: PickedFolder) => void
  onClose: () => void
  /** Anchor button — clicks inside this element are NOT treated as outside-click. */
  anchorRef?: React.RefObject<HTMLElement | null>
}

/**
 * Floating popover anchored over the editor toolbar. Lets the writer link an
 * image (asset → @slug) or a folder (folder → #slug) from the media library.
 */
export function MediaPickerPopover({
  folders,
  assets,
  onPickAsset,
  onPickFolder,
  onClose,
  anchorRef,
}: MediaPickerPopoverProps) {
  const [folderId, setFolderId] = useState<FolderId>('all')
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (anchorRef?.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter((a) => {
      if (folderId !== 'all' && a.folder_id !== folderId) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [assets, folderId, query])

  const activeFolder = folderId === 'all' ? null : folders.find((f) => f.id === folderId) ?? null

  return (
    <div
      ref={wrapRef}
      role="dialog"
      aria-label="Insert media from library"
      className="absolute right-0 top-[calc(100%+6px)] z-50 grid w-[640px] max-w-[calc(100vw-32px)] grid-cols-[180px_1fr] overflow-hidden rounded-xl border border-[#dadce0] bg-white shadow-2xl"
      style={{ height: 380 }}
    >
      {/* Folder rail */}
      <aside className="flex flex-col gap-0.5 overflow-y-auto border-r border-[#e8eaed] bg-[#f8f9fa] p-2">
        <div className="px-2 pt-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#9aa0a6]">
          Folders
        </div>
        <button
          type="button"
          onClick={() => setFolderId('all')}
          className={
            'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ' +
            (folderId === 'all'
              ? 'bg-white font-medium text-[#059669] ring-1 ring-[#059669]/40'
              : 'text-[#3c4043] hover:bg-white')
          }
        >
          <span className="truncate">All images</span>
          <span className="font-mono text-[10.5px] text-[#9aa0a6]">{assets.length}</span>
        </button>
        {folders.map((f) => (
          <div key={f.id} className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => setFolderId(f.id)}
              title={f.description ?? f.name}
              className={
                'flex flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ' +
                (folderId === f.id
                  ? 'bg-white font-medium text-[#059669] ring-1 ring-[#059669]/40'
                  : 'text-[#3c4043] hover:bg-white')
              }
            >
              <span className="truncate">{f.name}</span>
              <span className="font-mono text-[10.5px] text-[#9aa0a6]">{f.asset_count}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onPickFolder({ id: f.id, slug: f.slug, name: f.name, assetCount: f.asset_count })
              }
              title={`Insert #${f.slug} — bot picks the best image from this folder`}
              aria-label={`Insert folder reference ${f.slug}`}
              className="grid w-7 place-items-center rounded-md border border-dashed border-[#dadce0] text-[12px] font-semibold text-[#5f6368] hover:border-[#059669] hover:bg-[rgba(5,150,105,0.08)] hover:text-[#059669]"
            >
              #
            </button>
          </div>
        ))}
      </aside>

      {/* Main pane */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-[#e8eaed] bg-white px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeFolder ? `Search in ${activeFolder.name}…` : 'Search images…'}
            className="h-8 flex-1 rounded-md border border-[#dadce0] bg-white px-2.5 text-[12.5px] text-[#202124] outline-none focus:border-[#059669] focus:ring-2 focus:ring-[rgba(5,150,105,0.15)]"
            autoFocus
          />
          {activeFolder && (
            <button
              type="button"
              onClick={() =>
                onPickFolder({
                  id: activeFolder.id,
                  slug: activeFolder.slug,
                  name: activeFolder.name,
                  assetCount: activeFolder.asset_count,
                })
              }
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#059669] bg-[rgba(5,150,105,0.08)] px-2.5 text-[11.5px] font-medium text-[#059669]"
              title={`Insert #${activeFolder.slug}`}
            >
              Insert <code className="font-mono text-[10.5px]">#{activeFolder.slug}</code>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-[#9aa0a6] hover:bg-[#f1f3f4] hover:text-[#202124]"
          >
            ✕
          </button>
        </div>

        {visibleAssets.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-[12.5px] text-[#9aa0a6]">
            {assets.length === 0
              ? 'Upload images in the Media tab first, then come back to link them here.'
              : 'No images match.'}
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 overflow-y-auto p-3">
            {visibleAssets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  onPickAsset({ id: a.id, slug: a.slug, name: a.name, url: a.signed_url })
                }
                title={`Insert @${a.slug}`}
                className="group flex flex-col gap-1 rounded-lg border border-[#e8eaed] bg-white p-1.5 text-left transition-colors hover:border-[#059669] hover:bg-[rgba(5,150,105,0.04)]"
              >
                <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-[#f1f3f4]">
                  {a.signed_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.signed_url}
                      alt={a.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[10.5px] text-[#9aa0a6]">No preview</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-medium text-[#202124]">{a.name}</div>
                  <div className="truncate font-mono text-[10px] text-[#9aa0a6]">@{a.slug}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
