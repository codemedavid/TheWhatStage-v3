'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadMediaFiles } from '@/lib/media/client-upload'
import { MEDIA_KINDS, MEDIA_KIND_LIMITS, mediaKindFromMime, type MediaKind } from '@/lib/media/kind'

export interface PickedAsset {
  id: string
  name: string
  thumbUrl: string | null
  mimeType?: string
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
  /** Which library kinds to offer. Defaults to every kind. */
  kinds?: readonly MediaKind[]
}

function pickerNoun(kinds: readonly MediaKind[], plural: boolean): string {
  if (kinds.length === 1) {
    const one = kinds[0] === 'audio' ? 'voice message' : kinds[0]
    return plural ? `${one}s` : one
  }
  return plural ? 'media' : 'media'
}

function TilePreview({ asset }: { asset: AssetRow }) {
  const kind = mediaKindFromMime(asset.mime_type)
  if (kind === 'video') {
    return (
      <div className="mpm-tile-placeholder mpm-tile-av" aria-label="Video">
        {asset.thumbUrl ? <video src={asset.thumbUrl} muted preload="metadata" /> : null}
        <span className="mpm-tile-kind">▶ Video</span>
      </div>
    )
  }
  if (kind === 'audio') {
    return (
      <div className="mpm-tile-placeholder mpm-tile-av" aria-label="Voice message">
        <span className="mpm-tile-kind">🎙 Voice</span>
      </div>
    )
  }
  return asset.thumbUrl ? (
    <img src={asset.thumbUrl} alt={asset.name} loading="lazy" />
  ) : (
    <div className="mpm-tile-placeholder">{asset.name.slice(0, 2).toUpperCase()}</div>
  )
}

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  initialSelectedIds = [],
  maxSelect = 1,
  kinds = MEDIA_KINDS,
}: Props) {
  const accept = kinds.map((k) => MEDIA_KIND_LIMITS[k].accept).join(',')
  const nounOne = pickerNoun(kinds, false)
  const nounMany = pickerNoun(kinds, true)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    setOverCap(false)
    setSelected(new Map())
    fetch('/api/media/assets')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: AssetRow[] }) => {
        setAssets(j.assets.filter((a) => kinds.includes(mediaKindFromMime(a.mime_type) ?? 'image')))
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

      const created = await uploadMediaFiles({ folderId, files: [file] })
      const first = created[0]
      if (!first) throw new Error('Upload returned no asset')

      const listRes = await fetch('/api/media/assets')
      const listJson = (await listRes.json()) as { assets: AssetRow[] }
      setAssets(listJson.assets.filter((a) => kinds.includes(mediaKindFromMime(a.mime_type) ?? 'image')))
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
    onSelect(Array.from(selected.values()).map((a) => ({ id: a.id, name: a.name, thumbUrl: a.thumbUrl, mimeType: a.mime_type })))
    onClose()
  }

  return (
    <div className="mpm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mpm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mpm-head">
          <h3>{maxSelect > 1 ? `Pick up to ${maxSelect} ${nounMany}` : `Pick ${nounOne === 'media' ? 'media' : `a ${nounOne}`}`}</h3>
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
            accept={accept}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleUpload(f)
              e.target.value = ''
            }}
          />
        </div>

        {error && <p className="mpm-error" role="alert">{error}</p>}
        {overCap && <p className="mpm-cap-hint" role="status">Up to {maxSelect} {nounMany}.</p>}
        {loading && <p className="mpm-empty">Loading…</p>}
        {!loading && filtered.length === 0 && !error && (
          <p className="mpm-empty">No {nounMany} yet. Upload one to get started.</p>
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
                  <TilePreview asset={a} />
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
