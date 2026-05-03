'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMediaFolder, updateMediaAsset, updateMediaFolder } from '../actions'
import type { MediaAssetRow, MediaFolderRow } from '../_lib/queries'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null

  async function upload(formData: FormData) {
    setUploading(true)
    setUploadError(null)
    try {
      const res = await fetch('/dashboard/media/upload', { method: 'POST', body: formData })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="border-b border-[#F3F4F6] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[#111827]">Folders</h2>
        </div>
        <div className="divide-y divide-[#F3F4F6]">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => router.push(`/dashboard/media?folder=${folder.id}`)}
              className={`block w-full px-4 py-3 text-left ${folder.id === selectedFolderId ? 'bg-[#F9FAFB]' : 'bg-white hover:bg-[#F9FAFB]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-medium text-[#111827]">{folder.name}</span>
                <span className="text-[12px] text-[#9CA3AF]">{folder.asset_count}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11.5px] text-[#047857]">#{folder.slug}</div>
            </button>
          ))}
        </div>
        <form action={createMediaFolder} className="space-y-2 border-t border-[#F3F4F6] p-4">
          <input name="name" required placeholder="Folder name" className="h-9 w-full rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
          <textarea name="description" placeholder="Description" rows={3} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px]" />
          <button className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white">Create folder</button>
        </form>
      </aside>

      <main className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="border-b border-[#F3F4F6] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[#111827]">{selectedFolder?.name ?? 'No folder selected'}</h2>
          {selectedFolder ? <p className="mt-1 font-mono text-[12px] text-[#047857]">#{selectedFolder.slug}</p> : null}
        </div>

        {selectedFolder ? (
          <div className="space-y-5 p-5">
            <form action={updateMediaFolder} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="id" value={selectedFolder.id} />
              <input name="name" defaultValue={selectedFolder.name} className="h-9 rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
              <input name="slug" defaultValue={selectedFolder.slug} className="h-9 rounded-md border border-[#E5E7EB] px-3 font-mono text-[13px]" />
              <button className="rounded-md border border-[#D1D5DB] px-3 text-[13px] font-medium">Save folder</button>
              <textarea name="description" defaultValue={selectedFolder.description ?? ''} rows={2} className="md:col-span-3 rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px]" />
            </form>

            <form action={(fd) => void upload(fd)} className="rounded-lg border border-dashed border-[#D1D5DB] p-4">
              <input type="hidden" name="folderId" value={selectedFolder.id} />
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input ref={fileRef} name="files" type="file" multiple accept="image/*" className="text-[13px]" />
                <input name="sharedDescription" placeholder="Shared description for this batch" className="h-9 rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
                <button disabled={uploading} className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60">
                  {uploading ? 'Uploading...' : 'Upload images'}
                </button>
              </div>
              {uploadError ? <p className="mt-2 text-[12px] text-[#B91C1C]">{uploadError}</p> : null}
            </form>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {assets.map((asset) => (
                <article key={asset.id} className="overflow-hidden rounded-lg border border-[#E5E7EB]">
                  {asset.signed_url ? <img src={asset.signed_url} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-[#F3F4F6]" />}
                  <form action={(fd) => startTransition(() => void updateMediaAsset(fd))} className="space-y-2 p-3">
                    <input type="hidden" name="id" value={asset.id} />
                    <input type="hidden" name="folderId" value={asset.folder_id} />
                    <input name="name" defaultValue={asset.name} className="h-8 w-full rounded-md border border-[#E5E7EB] px-2 text-[12.5px]" />
                    <input name="slug" defaultValue={asset.slug} className="h-8 w-full rounded-md border border-[#E5E7EB] px-2 font-mono text-[12px]" />
                    <textarea name="description" defaultValue={asset.description ?? ''} rows={3} className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#047857]">@{asset.slug}</span>
                      <button disabled={isPending} className="rounded-md border border-[#D1D5DB] px-2.5 py-1.5 text-[12px] font-medium">Save</button>
                    </div>
                  </form>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[13px] text-[#6B7280]">Create a folder to start uploading reusable images.</div>
        )}
      </main>
    </div>
  )
}
