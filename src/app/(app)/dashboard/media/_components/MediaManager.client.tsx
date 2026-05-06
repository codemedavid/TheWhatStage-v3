'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMediaFolder, updateMediaAsset, updateMediaFolder } from '../actions'
import type { MediaAssetRow, MediaFolderRow } from '../_lib/queries'

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

function ImagePlaceholderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-5-5L5 21" />
    </svg>
  )
}

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.32 3.75 3.75 0 0 1 3.83 6.095H6.75Z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  )
}

const EMBED_STATUS = {
  indexed: { label: 'Indexed', dot: 'bg-emerald-500', ring: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  stale: { label: 'Needs sync', dot: 'bg-amber-400', ring: 'bg-amber-50 text-amber-700 ring-amber-200' },
  pending: { label: 'Pending', dot: 'bg-slate-300', ring: 'bg-slate-50 text-slate-500 ring-slate-200' },
} as const

function EmbedBadge({ status }: { status: keyof typeof EMBED_STATUS }) {
  const s = EMBED_STATUS[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${s.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function MediaManager({
  folders,
  assets,
  selectedFolderId,
}: {
  folders: MediaFolderRow[]
  assets: MediaAssetRow[]
  selectedFolderId: string | null
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [editingFolder, setEditingFolder] = useState(false)
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null

  async function uploadFiles(files: File[], description?: string) {
    if (!selectedFolder || !files.length) return
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('folderId', selectedFolder.id)
      if (description) fd.append('sharedDescription', description)
      for (const f of files) fd.append('files', f)
      const res = await fetch('/dashboard/media/upload', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    await uploadFiles(files)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) void uploadFiles(files)
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-gray-100 bg-gray-50/70">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="text-[11.5px] font-semibold uppercase tracking-widest text-gray-400">
            Folders
          </span>
          <button
            type="button"
            onClick={() => setShowNewFolder((v) => !v)}
            title="New folder"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {/* New-folder form */}
        {showNewFolder && (
          <div className="border-b border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">New Folder</p>
            <form
              action={async (fd) => { await createMediaFolder(fd); setShowNewFolder(false) }}
              className="space-y-2"
            >
              <input
                name="name"
                required
                placeholder="Folder name"
                autoFocus
                className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[12.5px] placeholder:text-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
              <textarea
                name="description"
                placeholder="Description (optional)"
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12.5px] placeholder:text-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
              <div className="flex gap-1.5">
                <button className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-emerald-700">
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFolder(false)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] text-gray-500 transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Folder list */}
        <nav className="flex-1 overflow-y-auto py-1">
          {folders.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-gray-400">No folders yet</p>
          ) : (
            folders.map((folder) => {
              const active = folder.id === selectedFolderId
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/media?folder=${folder.id}`)}
                  className={`group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <FolderIcon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? 'text-emerald-500' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                  />
                  <span className="flex-1 truncate text-[13px] font-medium">{folder.name}</span>
                  {folder.asset_count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                        active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {folder.asset_count}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </nav>
      </aside>

      {/* ── Main panel ──────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedFolder ? (
          <>
            {/* Folder header */}
            <div className="shrink-0 border-b border-gray-100 px-6 py-4">
              {editingFolder ? (
                <form
                  action={async (fd) => { await updateMediaFolder(fd); setEditingFolder(false) }}
                  className="space-y-2.5"
                >
                  <input type="hidden" name="id" value={selectedFolder.id} />
                  <div className="flex flex-wrap gap-2">
                    <input
                      name="name"
                      defaultValue={selectedFolder.name}
                      placeholder="Folder name"
                      className="h-9 rounded-lg border border-gray-200 px-3 text-[13.5px] font-semibold text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                    <input
                      name="slug"
                      defaultValue={selectedFolder.slug}
                      placeholder="slug"
                      className="h-9 rounded-lg border border-gray-200 px-3 font-mono text-[12.5px] text-emerald-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  <textarea
                    name="description"
                    defaultValue={selectedFolder.description ?? ''}
                    rows={1}
                    placeholder="Folder description..."
                    className="w-full max-w-lg resize-none rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                  <div className="flex gap-1.5">
                    <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-emerald-700">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingFolder(false)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] text-gray-500 transition-colors hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-semibold text-gray-900">
                      {selectedFolder.name}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[12px] text-emerald-700">#{selectedFolder.slug}</span>
                      {selectedFolder.description && (
                        <span className="max-w-sm truncate text-[12px] text-gray-400">
                          {selectedFolder.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingFolder(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Upload zone */}
            <div className="shrink-0 border-b border-gray-100 bg-gray-50/40 px-6 py-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`rounded-xl border-2 border-dashed transition-all duration-150 ${
                  isDragging
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className={`rounded-xl p-2.5 transition-colors ${isDragging ? 'bg-emerald-100' : 'bg-white shadow-sm'}`}>
                    <UploadCloudIcon className={`h-6 w-6 ${isDragging ? 'text-emerald-600' : 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold ${isDragging ? 'text-emerald-700' : 'text-gray-700'}`}>
                      {isDragging ? 'Drop to upload' : 'Upload images'}
                    </p>
                    <p className="text-[11.5px] text-gray-400">
                      Drag & drop or browse · JPEG, PNG, WebP, GIF · Max 10 MB each
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      ref={fileInputRef}
                      id="media-file-input"
                      type="file"
                      multiple
                      accept="image/*"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    <label
                      htmlFor="media-file-input"
                      className="cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-medium text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                    >
                      Browse files
                    </label>
                  </div>
                </div>

                {uploading && (
                  <div className="border-t border-emerald-100 bg-emerald-50/60 px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-emerald-100">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-500" />
                      </div>
                      <span className="text-[11.5px] font-medium text-emerald-700">Uploading…</span>
                    </div>
                  </div>
                )}

                {uploadError && (
                  <div className="border-t border-red-100 bg-red-50/60 px-5 py-2.5">
                    <p className="text-[12px] font-medium text-red-600">{uploadError}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Asset grid */}
            <div className="flex-1 overflow-y-auto p-6">
              {assets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="mb-4 rounded-2xl bg-gray-50 p-8">
                    <ImagePlaceholderIcon className="mx-auto h-12 w-12 text-gray-200" />
                  </div>
                  <p className="text-[14px] font-semibold text-gray-500">No images yet</p>
                  <p className="mt-1 text-[12.5px] text-gray-400">
                    Upload images above to start building your media library
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {assets.map((asset) => (
                    <article
                      key={asset.id}
                      className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-150 hover:border-gray-300 hover:shadow-md"
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-[4/3] overflow-hidden bg-gray-50">
                        {asset.signed_url ? (
                          <img
                            src={asset.signed_url}
                            alt={asset.name}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImagePlaceholderIcon className="h-10 w-10 text-gray-200" />
                          </div>
                        )}

                        {/* Status badge */}
                        <div className="absolute left-2 top-2">
                          <EmbedBadge status={asset.embedding_status} />
                        </div>

                        {/* Hover overlay */}
                        <button
                          type="button"
                          onClick={() => setEditingAssetId(editingAssetId === asset.id ? null : asset.id)}
                          className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/25 group-hover:opacity-100"
                        >
                          <span className="rounded-full bg-white/95 px-3.5 py-1.5 text-[12px] font-semibold text-gray-800 shadow-md">
                            {editingAssetId === asset.id ? 'Close' : 'Edit'}
                          </span>
                        </button>
                      </div>

                      {/* Name row (always visible) */}
                      <div className="border-t border-gray-100 px-3 py-2.5">
                        <p className="truncate text-[12.5px] font-semibold text-gray-800">{asset.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-emerald-700">@{asset.slug}</p>
                      </div>

                      {/* Inline edit form */}
                      {editingAssetId === asset.id && (
                        <form
                          action={(fd) => {
                            startTransition(() => void updateMediaAsset(fd))
                            setEditingAssetId(null)
                          }}
                          className="space-y-2 border-t border-gray-100 bg-gray-50/60 px-3 py-3"
                        >
                          <input type="hidden" name="id" value={asset.id} />
                          <input type="hidden" name="folderId" value={asset.folder_id} />
                          <input
                            name="name"
                            defaultValue={asset.name}
                            placeholder="Name"
                            className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-[12px] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          />
                          <input
                            name="slug"
                            defaultValue={asset.slug}
                            placeholder="slug"
                            className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2.5 font-mono text-[11.5px] text-emerald-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          />
                          <textarea
                            name="description"
                            defaultValue={asset.description ?? ''}
                            rows={2}
                            placeholder="Description for AI retrieval…"
                            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              disabled={isPending}
                              className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-50">
                              <input
                                type="checkbox"
                                name="isArchived"
                                defaultChecked={asset.is_archived}
                                className="h-3.5 w-3.5 rounded accent-gray-500"
                              />
                              Archive
                            </label>
                          </div>
                        </form>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 rounded-2xl bg-gray-50 p-10">
              <FolderIcon className="mx-auto h-14 w-14 text-gray-200" />
            </div>
            <p className="text-[14.5px] font-semibold text-gray-500">No folder selected</p>
            <p className="mt-1 text-[13px] text-gray-400">
              Create a folder using the <span className="font-medium text-gray-500">+</span> button to start uploading
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
