'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { sendAttachmentAsOperator, type AttachmentSendInput } from '../actions/messenger'
import { AudioTrimmer } from './AudioTrimmer'
import { describeSendError } from '../_lib/send-error'

type Tab = 'upload' | 'library' | 'url'

type Props = {
  leadId: string
  onSent: () => void
  onError: (message: string) => void
  onClose: () => void
}

interface LibraryAsset {
  id: string
  name: string
  mime_type: string
  thumbUrl: string | null
}

const URL_TYPES = ['image', 'video', 'audio', 'file'] as const

function mimeToAttachmentType(mime: string): AttachmentSendInput['attachmentType'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

type UploadOk = { url: string; attachmentType: AttachmentSendInput['attachmentType']; name: string }
type UploadResult = UploadOk | { error: string }

/**
 * Read the operator-upload response without assuming JSON. Proxies/tunnels
 * (ngrok, Vercel) reject oversized bodies with a 413 whose body is plain text
 * ("Request Entity Too Large"), so a naive res.json() throws an opaque parse
 * error. Map known statuses to clear, actionable messages.
 */
async function parseUploadResponse(res: Response): Promise<UploadResult> {
  if (res.status === 413) {
    return { error: 'That clip is too large to send. Trim it to a shorter selection and try again.' }
  }

  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // Non-JSON body (HTML error page, proxy message, etc.).
    return { error: res.ok ? 'Upload failed: unexpected server response' : `Upload failed (${res.status})` }
  }

  if (json && typeof json === 'object' && 'error' in json) {
    return { error: String((json as { error: unknown }).error) }
  }
  if (!res.ok) return { error: `Upload failed (${res.status})` }
  return json as UploadOk
}

export function AttachmentComposer({ leadId, onSent, onError, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('upload')
  const [sending, startSend] = useTransition()

  const send = (input: AttachmentSendInput) => {
    startSend(async () => {
      try {
        const result = await sendAttachmentAsOperator(leadId, input)
        if (!result.ok) {
          onError(describeSendError(result.error))
          return
        }
        onSent()
        onClose()
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Send failed')
      }
    })
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-3"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['upload', 'library', 'url'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="lead-focus rounded-full px-2.5 py-1 text-[11.5px] font-medium capitalize"
              style={
                tab === t
                  ? { background: 'var(--lead-accent)', color: '#fff' }
                  : { background: 'var(--lead-surface-2)', color: 'var(--lead-body)' }
              }
            >
              {t === 'url' ? 'Paste URL' : t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="lead-focus text-[12px]"
          style={{ color: 'var(--lead-muted)' }}
          aria-label="Close attachment panel"
        >
          ✕
        </button>
      </div>

      {tab === 'upload' && <UploadTab sending={sending} onSend={send} onError={onError} />}
      {tab === 'library' && <LibraryTab sending={sending} onSend={send} onError={onError} />}
      {tab === 'url' && <UrlTab sending={sending} onSend={send} />}
    </div>
  )
}

function UploadTab({
  sending,
  onSend,
  onError,
}: {
  sending: boolean
  onSend: (input: AttachmentSendInput) => void
  onError: (message: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingAudio, setPendingAudio] = useState<File | null>(null)
  const busy = sending || uploading

  const handleSelected = (file: File) => {
    // Audio routes through the trimmer first so the operator can choose what to
    // send; everything else uploads immediately.
    if (file.type.startsWith('audio/')) {
      setPendingAudio(file)
      return
    }
    void handleFile(file)
  }

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/messenger/operator-upload', { method: 'POST', body: form })

      // A 413 from the proxy/tunnel (e.g. ngrok) comes back as plain text, not
      // JSON, so we must not blindly res.json() — that throws the cryptic
      // "Unexpected token 'R', \"Request En\"…" error. Read defensively.
      const upload = await parseUploadResponse(res)
      if ('error' in upload) {
        onError(upload.error)
        return
      }
      onSend({
        source: 'upload',
        attachmentType: upload.attachmentType,
        url: upload.url,
        name: upload.name,
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (pendingAudio) {
    return (
      <AudioTrimmer
        file={pendingAudio}
        busy={busy}
        onConfirm={(trimmed) => {
          setPendingAudio(null)
          void handleFile(trimmed)
        }}
        onCancel={() => setPendingAudio(null)}
        onError={onError}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,audio/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleSelected(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="lead-focus rounded-lg px-3 py-3 text-[12.5px] font-medium disabled:opacity-50"
        style={{ border: '1px dashed var(--lead-line)', color: 'var(--lead-body)' }}
      >
        {busy ? 'Sending…' : 'Choose a file to send (image, video, voice, PDF)'}
      </button>
      <p className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
        Max 25 MB. Voice clips can be trimmed before sending. Sending pauses the bot.
      </p>
    </div>
  )
}

function LibraryTab({
  sending,
  onSend,
  onError,
}: {
  sending: boolean
  onSend: (input: AttachmentSendInput) => void
  onError: (message: string) => void
}) {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/media/assets')
      .then((r) => r.json())
      .then((j: { assets?: LibraryAsset[]; error?: string }) => {
        if (cancelled) return
        if (j.error) onError(j.error)
        else setAssets(j.assets ?? [])
      })
      .catch((e) => !cancelled && onError(e instanceof Error ? e.message : 'Failed to load media'))
    return () => {
      cancelled = true
    }
  }, [onError])

  if (assets === null) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--lead-muted)' }}>
        Loading media…
      </p>
    )
  }
  if (assets.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--lead-muted)' }}>
        No media in your library yet.
      </p>
    )
  }

  return (
    <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto">
      {assets.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={sending}
          title={a.name}
          onClick={() => onSend({ source: 'asset', attachmentType: mimeToAttachmentType(a.mime_type), assetId: a.id })}
          className="lead-focus aspect-square overflow-hidden rounded-lg disabled:opacity-50"
          style={{ border: '1px solid var(--lead-line)' }}
        >
          {a.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.thumbUrl} alt={a.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px]">{a.name}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function UrlTab({
  sending,
  onSend,
}: {
  sending: boolean
  onSend: (input: AttachmentSendInput) => void
}) {
  const [url, setUrl] = useState('')
  const [type, setType] = useState<(typeof URL_TYPES)[number]>('image')
  const canSend = url.trim().startsWith('https://') && !sending

  return (
    <div className="flex flex-col gap-2">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className="lead-focus rounded-lg px-3 py-2 text-[13px] outline-none"
        style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)', color: 'var(--lead-ink)' }}
      />
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as (typeof URL_TYPES)[number])}
          className="lead-focus rounded-lg px-2 py-1.5 text-[12.5px] capitalize"
          style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)', color: 'var(--lead-ink)' }}
        >
          {URL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => onSend({ source: 'url', attachmentType: type, url: url.trim() })}
          className="lead-focus rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
        Only https URLs are accepted.
      </p>
    </div>
  )
}
