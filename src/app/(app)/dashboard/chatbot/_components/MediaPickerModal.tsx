'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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
  onSelect: (assets: PickedAsset[]) => void
  initialSelectedIds?: string[]
  maxSelect?: number
}

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  initialSelectedIds = [],
  maxSelect = 1,
}: Props) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overCap, setOverCap] = useState(false)
  // Insertion-ordered map: preserves pick order for the ordinal badge.
  const [selected, setSelected] = useState<Map<string, AssetRow>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Reset selection on open: pre-populate from initialSelectedIds once the asset
  // list comes back from the server.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setOverCap(false)
    setSelected(new Map())
    fetch('/api/media/assets')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: AssetRow[] }) => {
        setAssets(j.assets)
        if (initialSelectedIds.length > 0) {
          const next = new Map<string, AssetRow>()
          // Preserve the order from initialSelectedIds so the ordinal badges match.
          for (const id of initialSelectedIds) {
            const found = j.assets.find((a) => a.id === id)
            if (found) next.set(id, found)
          }
          setSelected(next)
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // We intentionally do not depend on initialSelectedIds — open is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ESC key = cancel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets
  }, [assets, query])

  if (!open) return null

  function toggle(asset: AssetRow) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(asset.id)) {
        next.delete(asset.id)
        setOverCap(false)
        return next
      }
      if (next.size >= maxSelect) {
        setOverCap(true)
        // auto-clear the warning after a moment
        window.setTimeout(() => setOverCap(false), 1500)
        return prev
      }
      next.set(asset.id, asset)
      return next
    })
  }

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
      setAssets(listJson.assets)
      const fresh = listJson.assets.find((a) => a.id === first.id)
      if (fresh) {
        setSelected((prev) => {
          if (prev.has(fresh.id)) return prev
          if (prev.size >= maxSelect) {
            setOverCap(true)
            window.setTimeout(() => setOverCap(false), 1500)
            return prev
          }
          const next = new Map(prev)
          next.set(fresh.id, fresh)
          return next
        })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function commit() {
    onSelect(Array.from(selected.values()).map((a) => ({ id: a.id, name: a.name, thumbUrl: a.thumbUrl })))
    onClose()
  }

  return (
    <div className="mpm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mpm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mpm-head">
          <h3>{maxSelect > 1 ? `Pick up to ${maxSelect} images` : 'Pick an image'}</h3>
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
        {overCap && <p className="mpm-cap-hint" role="status">Up to {maxSelect} images.</p>}
        {loading && <p className="mpm-empty">Loading…</p>}
        {!loading && filtered.length === 0 && !error && (
          <p className="mpm-empty">No images. Upload one to get started.</p>
        )}

        <ul className="mpm-grid">
          {filtered.map((a) => {
            const sel = selected.has(a.id)
            const ordinal = sel ? Array.from(selected.keys()).indexOf(a.id) + 1 : 0
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`mpm-tile${sel ? ' is-selected' : ''}`}
                  onClick={() => toggle(a)}
                  aria-pressed={sel}
                >
                  {a.thumbUrl ? (
                    <img src={a.thumbUrl} alt={a.name} loading="lazy" />
                  ) : (
                    <div className="mpm-tile-placeholder">{a.name.slice(0, 2).toUpperCase()}</div>
                  )}
                  {sel && <span className="mpm-tile-badge" aria-hidden>{ordinal}</span>}
                  <span className="mpm-tile-name" title={a.name}>{a.name}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <footer className="mpm-foot">
          <button type="button" className="mpm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mpm-btn mpm-btn-primary" onClick={commit}>
            Done ({selected.size})
          </button>
        </footer>
      </div>
    </div>
  )
}
