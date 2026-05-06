'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { MediaAssetRow, MediaFolderRow } from '@/app/(app)/dashboard/media/_lib/queries'
import {
  MediaMentionList,
  type MediaMentionItem,
  type MediaMentionListHandle,
} from '../../knowledge/_components/MediaMentionList'

interface Props {
  id?: string
  name?: string
  defaultValue?: string
  value?: string
  onChange?: (next: string) => void
  rows?: number
  className?: string
  placeholder?: string
  assets: MediaAssetRow[]
  folders: MediaFolderRow[]
}

export function MentionTextarea({
  id,
  name,
  defaultValue = '',
  value: controlled,
  onChange,
  rows = 10,
  className,
  placeholder,
  assets,
  folders,
}: Props) {
  const isControlled = controlled !== undefined
  const [internal, setInternal] = useState(defaultValue)
  const value = isControlled ? (controlled as string) : internal
  const setValue = (v: string) => {
    if (!isControlled) setInternal(v)
    onChange?.(v)
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<MediaMentionListHandle>(null)

  type Trigger = {
    char: '@' | '#'
    start: number
    query: string
    coords: { top: number; left: number; lineHeight: number }
  }
  const [trigger, setTrigger] = useState<Trigger | null>(null)

  const assetItems: MediaMentionItem[] = useMemo(
    () =>
      assets.map((a) => {
        const folder = folders.find((f) => f.id === a.folder_id)
        return {
          kind: 'asset' as const,
          id: a.id,
          slug: a.slug,
          name: a.name,
          url: a.signed_url,
          folderName: folder?.name ?? null,
        }
      }),
    [assets, folders],
  )
  const folderItems: MediaMentionItem[] = useMemo(
    () =>
      folders.map((f) => ({
        kind: 'folder' as const,
        id: f.id,
        slug: f.slug,
        name: f.name,
        assetCount: f.asset_count,
      })),
    [folders],
  )

  const matches = useMemo<MediaMentionItem[]>(() => {
    if (!trigger) return []
    const pool = trigger.char === '@' ? assetItems : folderItems
    const q = trigger.query.trim().toLowerCase()
    if (!q) return pool.slice(0, 8)
    return pool
      .map((it) => {
        const slugScore = scoreToken(it.slug, q) * 1.2
        const nameScore = scoreToken(it.name, q)
        return { it, score: Math.max(slugScore, nameScore) }
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((row) => row.it)
  }, [trigger, assetItems, folderItems])

  const measureCaret = useCallback(
    (offset: number): { top: number; left: number; lineHeight: number } => {
      const ta = textareaRef.current
      if (!ta) return { top: 0, left: 0, lineHeight: 16 }
      const div = ensureCaretMirror()
      copyTextareaStyles(ta, div)
      const before = ta.value.slice(0, offset)
      div.textContent = before
      const marker = document.createElement('span')
      marker.textContent = '\u200b'
      div.appendChild(marker)
      const rect = ta.getBoundingClientRect()
      const style = window.getComputedStyle(ta)
      const lineHeight = parseFloat(style.lineHeight) || 16
      const top =
        rect.top +
        marker.offsetTop -
        ta.scrollTop +
        parseFloat(style.borderTopWidth || '0')
      const left =
        rect.left +
        marker.offsetLeft -
        ta.scrollLeft +
        parseFloat(style.borderLeftWidth || '0')
      return { top, left, lineHeight }
    },
    [],
  )

  const evaluateTrigger = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? 0
    if (caret !== ta.selectionEnd) {
      setTrigger(null)
      return
    }
    const text = ta.value
    let i = caret - 1
    while (i >= 0) {
      const ch = text[i]
      if (ch === '@' || ch === '#') {
        const prev = i === 0 ? '' : text[i - 1]
        const okPrev = i === 0 || /[\s(\[]/.test(prev)
        if (!okPrev) {
          setTrigger(null)
          return
        }
        const query = text.slice(i + 1, caret)
        if (/\s/.test(query)) {
          setTrigger(null)
          return
        }
        const coords = measureCaret(i)
        setTrigger({ char: ch as '@' | '#', start: i, query, coords })
        return
      }
      if (/\s/.test(ch)) break
      i -= 1
    }
    setTrigger(null)
  }, [measureCaret])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
  }

  useEffect(() => {
    evaluateTrigger()
  }, [value, evaluateTrigger])

  const insert = useCallback(
    (item: MediaMentionItem) => {
      if (!trigger) return
      const ta = textareaRef.current
      if (!ta) return
      const char = item.kind === 'asset' ? '@' : '#'
      const token = `${char}${item.slug} `
      const next =
        value.slice(0, trigger.start) +
        token +
        value.slice(ta.selectionEnd ?? value.length)
      setValue(next)
      const caretAfter = trigger.start + token.length
      requestAnimationFrame(() => {
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(caretAfter, caretAfter)
      })
      setTrigger(null)
    },
    [trigger, value],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger) return
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'Enter' ||
      e.key === 'Tab'
    ) {
      const handled = listRef.current?.onKeyDown(e.nativeEvent)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    if (e.key === 'Escape') {
      setTrigger(null)
    }
  }

  const highlighted = useMemo(() => renderHighlighted(value), [value])

  useLayoutEffect(() => {
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (!ta || !mirror) return
    const sync = () => {
      mirror.scrollTop = ta.scrollTop
      mirror.scrollLeft = ta.scrollLeft
    }
    ta.addEventListener('scroll', sync)
    sync()
    return () => ta.removeEventListener('scroll', sync)
  }, [])

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="mention-ta-wrap">
      <div
        ref={mirrorRef}
        aria-hidden
        className={`${className ?? ''} mention-ta-mirror`}
      >
        {highlighted}
        {'\u200b'}
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        rows={rows}
        value={value}
        placeholder={placeholder}
        className={`${className ?? ''} mention-ta-input`}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onClick={evaluateTrigger}
        onSelect={evaluateTrigger}
        onBlur={() => setTimeout(() => setTrigger(null), 120)}
        spellCheck
      />
      {mounted && trigger
        ? createPortal(
            <div
              className="media-mention-floater"
              style={{
                top: trigger.coords.top + trigger.coords.lineHeight + 6,
                left: trigger.coords.left,
              }}
            >
              <MediaMentionList
                ref={listRef}
                items={matches}
                command={insert}
                query={trigger.query}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function scoreToken(haystack: string, q: string): number {
  if (!q) return 1
  const h = haystack.toLowerCase()
  if (h === q) return 100
  if (h.startsWith(q)) return 50
  if (h.includes(q)) return 20
  return 0
}

function renderHighlighted(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /([@#])([a-z0-9][a-z0-9_-]*)/gi
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const cls =
      m[1] === '#'
        ? 'media-mention media-mention--folder'
        : 'media-mention media-mention--asset'
    out.push(
      <span key={key++} className={cls}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

let caretMirrorEl: HTMLDivElement | null = null
function ensureCaretMirror(): HTMLDivElement {
  if (caretMirrorEl) return caretMirrorEl
  const div = document.createElement('div')
  div.setAttribute('aria-hidden', 'true')
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '-9999px'
  document.body.appendChild(div)
  caretMirrorEl = div
  return div
}

const CSS_PROPS_TO_COPY = [
  'boxSizing',
  'width',
  'height',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'whiteSpace',
] as const
function copyTextareaStyles(ta: HTMLTextAreaElement, target: HTMLDivElement) {
  const cs = window.getComputedStyle(ta)
  for (const prop of CSS_PROPS_TO_COPY) {
    ;(target.style as unknown as Record<string, string>)[prop] =
      (cs as unknown as Record<string, string>)[prop]
  }
  target.style.width = `${ta.clientWidth}px`
}
