'use client'

import type { Editor, Range } from '@tiptap/core'
import { mergeAttributes } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Mention from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { MediaAssetRow, MediaFolderRow } from '@/app/(app)/dashboard/media/_lib/queries'
import type { MediaMentionItem } from './MediaMentionList'

const ASSET_KEY = new PluginKey('mediaAssetMention')
const FOLDER_KEY = new PluginKey('mediaFolderMention')

interface BuildOptions {
  assets: MediaAssetRow[]
  folders: MediaFolderRow[]
}

/**
 * Plugin → React bridge. The Suggestion plugin emits lifecycle events; a sibling
 * React component (`<MediaMentionPopover>`) listens to them and renders the
 * popover via a portal inside the React tree. This avoids fighting with
 * Tiptap's `ReactRenderer`, which had been silently no-op'ing on us.
 */
type SuggestionState = {
  open: boolean
  char: '@' | '#'
  query: string
  rect: { top: number; left: number; bottom: number; height: number } | null
  items: MediaMentionItem[]
  command: ((item: MediaMentionItem) => void) | null
}

type Listener = (state: SuggestionState) => void
type KeyHandler = ((event: KeyboardEvent) => boolean) | null

class SuggestionBus {
  private listeners = new Set<Listener>()
  private keyHandler: KeyHandler = null
  state: SuggestionState = {
    open: false,
    char: '@',
    query: '',
    rect: null,
    items: [],
    command: null,
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    l(this.state)
    return () => {
      this.listeners.delete(l)
    }
  }
  emit(next: Partial<SuggestionState>) {
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l(this.state)
  }
  setKeyHandler(h: KeyHandler) {
    this.keyHandler = h
  }
  invokeKey(event: KeyboardEvent): boolean {
    return this.keyHandler ? this.keyHandler(event) : false
  }
}

export const mediaMentionBus = new SuggestionBus()

function fuzzyScore(haystack: string, query: string): number {
  if (!query) return 1
  const h = haystack.toLowerCase()
  const q = query.toLowerCase()
  if (h === q) return 100
  if (h.startsWith(q)) return 50
  if (h.includes(q)) return 20
  return 0
}

function rectFrom(domRect: DOMRect | null | undefined) {
  if (!domRect) return null
  return {
    top: domRect.top,
    left: domRect.left,
    bottom: domRect.bottom,
    height: domRect.height,
  }
}

export function buildMediaMention({ assets, folders }: BuildOptions) {
  const assetItems: MediaMentionItem[] = assets.map((a) => {
    const folder = folders.find((f) => f.id === a.folder_id)
    return {
      kind: 'asset',
      id: a.id,
      slug: a.slug,
      name: a.name,
      url: a.signed_url,
      folderName: folder?.name ?? null,
    }
  })
  const folderItems: MediaMentionItem[] = folders.map((f) => ({
    kind: 'folder',
    id: f.id,
    slug: f.slug,
    name: f.name,
    assetCount: f.asset_count,
  }))

  const filterItems = (pool: MediaMentionItem[], query: string): MediaMentionItem[] => {
    const q = query.trim()
    return pool
      .map((it) => {
        const score = Math.max(
          fuzzyScore(it.slug, q) * 1.2,
          fuzzyScore(it.name, q),
        )
        return { it, score }
      })
      .filter((row) => row.score > 0 || q === '')
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((row) => row.it)
  }

  const insert = ({
    editor,
    range,
    props,
  }: {
    editor: Editor
    range: Range
    props: MediaMentionItem
  }) => {
    const char = props.kind === 'asset' ? '@' : '#'
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: 'mention',
          attrs: {
            id: props.slug,
            label: props.slug,
            kind: props.kind,
            mentionSuggestionChar: char,
          },
        },
        { type: 'text', text: ' ' },
      ])
      .run()
  }

  const makeRender = () => () => ({
    onStart(props: SuggestionProps<MediaMentionItem>) {
      mediaMentionBus.emit({
        open: true,
        char: props.text?.[0] === '#' ? '#' : '@',
        query: props.query ?? '',
        rect: rectFrom(props.clientRect?.()),
        items: props.items as MediaMentionItem[],
        command: (item: MediaMentionItem) => props.command(item),
      })
    },
    onUpdate(props: SuggestionProps<MediaMentionItem>) {
      mediaMentionBus.emit({
        open: true,
        char: props.text?.[0] === '#' ? '#' : '@',
        query: props.query ?? '',
        rect: rectFrom(props.clientRect?.()),
        items: props.items as MediaMentionItem[],
        command: (item: MediaMentionItem) => props.command(item),
      })
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') {
        mediaMentionBus.emit({ open: false })
        return true
      }
      return mediaMentionBus.invokeKey(props.event)
    },
    onExit() {
      mediaMentionBus.emit({ open: false, command: null })
    },
  })

  return Mention.extend({
    addAttributes() {
      return {
        ...(this.parent?.() ?? {}),
        kind: {
          default: 'asset',
          parseHTML: (el) => el.getAttribute('data-kind') ?? 'asset',
          renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
        },
      }
    },
  }).configure({
    HTMLAttributes: { class: 'media-mention' },
    renderText({ node }) {
      const char = node.attrs.kind === 'folder' ? '#' : (node.attrs.mentionSuggestionChar ?? '@')
      return `${char}${node.attrs.label ?? node.attrs.id}`
    },
    renderHTML({ node, options }) {
      const char = node.attrs.kind === 'folder' ? '#' : (node.attrs.mentionSuggestionChar ?? '@')
      return [
        'span',
        mergeAttributes(options.HTMLAttributes, {
          'data-kind': node.attrs.kind,
          class: `media-mention media-mention--${node.attrs.kind}`,
        }),
        `${char}${node.attrs.label ?? node.attrs.id}`,
      ]
    },
    suggestions: [
      {
        char: '@',
        pluginKey: ASSET_KEY,
        allowSpaces: false,
        items: ({ query }) => filterItems(assetItems, query),
        command: ({ editor, range, props }) =>
          insert({ editor, range, props: { ...(props as MediaMentionItem), kind: 'asset' } as MediaMentionItem }),
        render: makeRender(),
      },
      {
        char: '#',
        pluginKey: FOLDER_KEY,
        allowSpaces: false,
        items: ({ query }) => filterItems(folderItems, query),
        command: ({ editor, range, props }) =>
          insert({ editor, range, props: { ...(props as MediaMentionItem), kind: 'folder' } as MediaMentionItem }),
        render: makeRender(),
      },
    ],
  })
}
