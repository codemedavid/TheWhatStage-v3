'use client'

import { useEffect, useRef, useState } from 'react'

export interface PickedAsset {
  id: string
  name: string
  thumbUrl: string | null
}

interface AssetRow extends PickedAsset {
  slug: string
  mime_type: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (asset: PickedAsset) => void
}

export function MediaPickerModal({ open, onClose, onSelect }: Props) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch('/api/media/assets')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: AssetRow[] }) => setAssets(j.assets))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const filtered = query.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : assets

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const folderRes = await fetch('/api/media/default-folder')
      if (!folderRes.ok) throw new Error(await folderRes.text())
      const { folderId } = (await folderRes.json()) as { folderId: string }

      const form = new FormData()
      form.append('folderId', folderId)
      form.append('files', file)
      const upRes = await fetch('/dashboard/media/upload', { method: 'POST', body: form })
      if (!upRes.ok) throw new Error(await upRes.text())
      const { assets: created } = (await upRes.json()) as { assets: Array<{ id: string; name: string; storage_path: string }> }
      const first = created[0]
      if (!first) throw new Error('Upload returned no asset')

      const listRes = await fetch('/api/media/assets')
      const listJson = (await listRes.json()) as { assets: AssetRow[] }
      const fresh = listJson.assets.find((a) => a.id === first.id)
      onSelect({ id: first.id, name: first.name, thumbUrl: fresh?.thumbUrl ?? null })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mpm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mpm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mpm-head">
          <h3>Pick an image</h3>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="mpm-tools">
          <input
            type="search"
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mpm-search"
          />
          <button
            type="button"
            className="mpm-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload new'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleUpload(f)
              e.target.value = ''
            }}
          />
        </div>

        {error && <p className="mpm-error" role="alert">{error}</p>}
        {loading && <p className="mpm-empty">Loading…</p>}
        {!loading && filtered.length === 0 && !error && (
          <p className="mpm-empty">No images. Upload one to get started.</p>
        )}

        <ul className="mpm-grid">
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="mpm-tile"
                onClick={() => { onSelect({ id: a.id, name: a.name, thumbUrl: a.thumbUrl }); onClose() }}
              >
                {a.thumbUrl ? (
                  <img src={a.thumbUrl} alt={a.name} loading="lazy" />
                ) : (
                  <div className="mpm-tile-placeholder">{a.name.slice(0, 2).toUpperCase()}</div>
                )}
                <span className="mpm-tile-name" title={a.name}>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
