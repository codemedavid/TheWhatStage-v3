'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import {
  autosaveDocument,
  saveDocument,
  setDocumentCategory,
  deleteDocument,
} from '../actions/documents'
import type { CategoryRow, DocumentRow, TagRow } from '../_lib/queries'
import { PinButton } from './PinButton'
import { TagPicker } from './TagPicker'
import { DocumentOutline } from './DocumentOutline'

const AUTOSAVE_DEBOUNCE_MS = 1500

type SaveState =
  | 'idle'
  | 'dirty'
  | 'saving-draft'
  | 'saved-draft'
  | 'saving'
  | 'error'

// Two-stage mount: render only on the client. Tiptap v3 + React 19 strict
// mode is unreliable when initialised through SSR (immediatelyRender: false)
// because the instance can be torn down before onCreate fires.
export function DocumentEditor({
  doc,
  categories,
  tags,
}: {
  doc: DocumentRow
  categories: CategoryRow[]
  tags: TagRow[]
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div data-knowledge-root className="-mx-8 -my-6 min-h-[calc(100vh-3rem)]">
        <div className="px-4 py-8">
          <div className="mx-auto w-full max-w-[816px]">
            <div className="tiptap-paper px-[96px] py-[72px] text-[13px] text-[#9aa0a6]">
              Loading editor…
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <DocumentEditorImpl doc={doc} categories={categories} tags={tags} />
}

function DocumentEditorImpl({
  doc,
  categories,
  tags,
}: {
  doc: DocumentRow
  categories: CategoryRow[]
  tags: TagRow[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState(doc.title)
  const [state, setState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [version, setVersion] = useState(doc.version)
  const [editorReady, setEditorReady] = useState(false)
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [outlineJson, setOutlineJson] = useState<unknown>(
    (doc.draft_json as object | null) ?? (doc.content_json as object | null) ?? null,
  )
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()

  // Refs decouple Save from React render cycles & editor mount state.
  const titleRef = useRef(title)
  titleRef.current = title

  const latestRef = useRef<{
    json: unknown
    html: string
    text: string
  }>({
    json:
      (doc.draft_json as object | null) ??
      (doc.content_json as object | null) ??
      null,
    html: doc.draft_html ?? doc.content_html ?? '',
    text: doc.draft_text ?? doc.content_text ?? '',
  })

  const seqRef = useRef(0)
  const lastAppliedSeqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userInteractedRef = useRef(false)
  const editorRef = useRef<Editor | null>(null)

  const uploadAndInsertImage = useCallback(
    async (file: File) => {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('docId', doc.id)
      try {
        const res = await fetch('/dashboard/knowledge/upload', {
          method: 'POST',
          body: fd,
        })
        const json = (await res.json()) as { url?: string; error?: string }
        if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed')
        editorRef.current
          ?.chain()
          .focus()
          .setImage({ src: json.url, alt: file.name })
          .run()
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Image upload failed')
      }
    },
    [doc.id],
  )

  // Tiptap content: prefer draft, then committed content, otherwise empty doc.
  // Use a real ProseMirror-friendly empty value (`<p></p>`) — empty string can
  // cause the schema to reject the initial doc and silently produce a
  // non-editable view.
  const initialContent: string | object =
    (doc.draft_json as object | null) ??
    (doc.content_json as object | null) ??
    '<p></p>'

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
        // StarterKit v3 ships Link — configure it here instead of duplicating.
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: {
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing about your business…',
        emptyEditorClass: 'is-editor-empty',
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'kn-img' },
      }),
    ],
    content: initialContent,
    // Now safe: the parent two-stage-mounted us, so we're definitely client-side.
    immediatelyRender: true,
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
        spellcheck: 'true',
      },
      // Paste cleanup: strip Word/Google Docs <span style> noise so pasted
      // text adopts our document styles instead of carrying foreign fonts.
      transformPastedHTML(html) {
        return html
          .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<meta[^>]*>/gi, '')
          .replace(/ class="[^"]*Mso[^"]*"/g, '')
          .replace(/ style="[^"]*"/g, '')
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              event.preventDefault()
              void uploadAndInsertImage(file)
              return true
            }
          }
        }
        return false
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        const file = files[0]
        if (!file.type.startsWith('image/')) return false
        event.preventDefault()
        void uploadAndInsertImage(file)
        return true
      },
    },
    onCreate: ({ editor }) => {
      setEditorReady(true)
      editorRef.current = editor
      latestRef.current = {
        json: editor.getJSON(),
        html: editor.getHTML(),
        text: editor.getText(),
      }
      setStats(computeStats(editor.getText()))
      console.log('[DocumentEditor] mounted')
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      latestRef.current = {
        json,
        html: editor.getHTML(),
        text: editor.getText(),
      }
      setStats(computeStats(editor.getText()))
      setOutlineJson(json)
      userInteractedRef.current = true
      triggerAutosave()
    },
  })

  const triggerAutosave = useCallback(() => {
    setState('dirty')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runAutosave()
    }, AUTOSAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runAutosave = useCallback(async () => {
    const seq = ++seqRef.current
    setState('saving-draft')
    try {
      await autosaveDocument({
        id: doc.id,
        title: titleRef.current.trim() || 'Untitled',
        draftJson: latestRef.current.json ?? null,
        draftHtml: latestRef.current.html,
        draftText: latestRef.current.text,
      })
      if (seq < lastAppliedSeqRef.current) return
      lastAppliedSeqRef.current = seq
      setState((cur) => (cur === 'dirty' ? 'dirty' : 'saved-draft'))
      setErrorMsg(null)
    } catch (e) {
      if (seq < lastAppliedSeqRef.current) return
      setState('error')
      setErrorMsg(e instanceof Error ? e.message : 'Autosave failed')
    }
  }, [doc.id])

  // Cmd/Ctrl+S → save. Cmd/Ctrl+K → link the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSave()
      } else if (meta && e.key.toLowerCase() === 'k') {
        if (editorRef.current) {
          e.preventDefault()
          promptLink(editorRef.current)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Warn on close if unsaved.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'saving-draft') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleTitleChange = (v: string) => {
    setTitle(v)
    userInteractedRef.current = true
    triggerAutosave()
  }

  const handleSave = () => {
    startSave(async () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      setState('saving')
      try {
        // Flush latest content (works even if editor is null — we'd just save title + previous content).
        await autosaveDocument({
          id: doc.id,
          title: titleRef.current.trim() || 'Untitled',
          draftJson: latestRef.current.json ?? null,
          draftHtml: latestRef.current.html,
          draftText: latestRef.current.text,
        })
        const result = await saveDocument({ id: doc.id })
        setVersion(result.version)
        setState('idle')
        setErrorMsg(null)
        router.refresh()
      } catch (e) {
        setState('error')
        setErrorMsg(e instanceof Error ? e.message : 'Save failed')
      }
    })
  }

  const handleDelete = () => {
    if (!confirm('Delete this document? This cannot be undone.')) return
    startDelete(async () => {
      try {
        await deleteDocument({ id: doc.id })
        router.push('/dashboard/knowledge')
        router.refresh()
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to delete')
      }
    })
  }

  const handleCategoryChange = async (categoryId: string | null) => {
    try {
      await setDocumentCategory({ id: doc.id, categoryId })
      router.refresh()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update category')
    }
  }

  return (
    <div data-knowledge-root className="-mx-8 -my-6 min-h-[calc(100vh-3rem)]">
      {/* Sticky document chrome */}
      <div className="sticky top-0 z-30 border-b border-[#e8eaed] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[920px] items-center gap-3 px-6 py-2.5">
          <Link
            href="/dashboard/knowledge"
            className="text-[12.5px] text-[#5f6368] hover:text-[#202124]"
          >
            ← Knowledge
          </Link>
          <span className="text-[#dadce0]">/</span>
          <span className="truncate text-[12.5px] font-medium text-[#202124]">
            {title || 'Untitled'}
          </span>
          <SaveStatusBadge state={state} version={version} />
          <div className="ml-auto flex items-center gap-2">
            <PinButton id={doc.id} pinned={doc.is_pinned} size="sm" />
            <TagPicker
              docId={doc.id}
              allTags={tags}
              selectedIds={doc.tag_ids}
            />
            <CategorySelect
              categories={categories}
              value={doc.category_id}
              onChange={handleCategoryChange}
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={deletePending}
              className="inline-flex h-8 items-center rounded-md border border-[#dadce0] bg-white px-3 text-[12.5px] font-medium text-[#5f6368] hover:border-red-300 hover:text-red-600 disabled:opacity-60"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={savePending}
              className="inline-flex h-8 items-center rounded-md bg-[#059669] px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#047857] disabled:opacity-60"
              title="Save (⌘S / Ctrl+S)"
            >
              {savePending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <Toolbar editor={editor} onPickImage={uploadAndInsertImage} />
      </div>

      {errorMsg && (
        <div className="mx-auto mt-3 max-w-[920px] px-6">
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            {errorMsg}
          </div>
        </div>
      )}

      {/* Paper canvas + left outline */}
      <div className="px-4 py-8">
        <div className="mx-auto flex w-full max-w-[1100px] gap-8">
          <aside className="hidden w-[200px] shrink-0 lg:block">
            <div className="sticky top-[120px]">
              <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#5f6368]">
                Outline
              </h3>
              <DocumentOutline json={outlineJson} />
            </div>
          </aside>
          <div className="mx-auto w-full max-w-[816px] flex-1">
          <div className="tiptap-paper tiptap-editor overflow-hidden">
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled"
              spellCheck
              className="block w-full bg-transparent px-[96px] pt-[72px] pb-2 text-[36px] font-bold leading-tight tracking-tight text-[#202124] outline-none placeholder:text-[#9aa0a6]"
            />
            <div className="px-[96px] pb-[96px]">
              {!editorReady && (
                <div className="pt-2 pb-6 text-[13px] text-[#9aa0a6]">
                  Loading editor…
                </div>
              )}
              {editor && (
                <BubbleMenu
                  editor={editor}
                  className="flex items-center gap-0.5 rounded-lg border border-[#dadce0] bg-white px-1 py-1 shadow-md"
                >
                  <BubbleBtn
                    label="Bold"
                    active={editor.isActive('bold')}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                  >
                    <span className="text-[13px] font-bold">B</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Italic"
                    active={editor.isActive('italic')}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                  >
                    <span className="text-[13px] italic">I</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Strikethrough"
                    active={editor.isActive('strike')}
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                  >
                    <span className="text-[13px] line-through">S</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Code"
                    active={editor.isActive('code')}
                    onClick={() => editor.chain().focus().toggleCode().run()}
                  >
                    <span className="text-[12px] font-mono">{'</>'}</span>
                  </BubbleBtn>
                  <span className="mx-1 h-4 w-px bg-[#e8eaed]" />
                  <BubbleBtn
                    label="Heading 2"
                    active={editor.isActive('heading', { level: 2 })}
                    onClick={() =>
                      editor.chain().focus().toggleHeading({ level: 2 }).run()
                    }
                  >
                    <span className="text-[12px] font-bold">H2</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Quote"
                    active={editor.isActive('blockquote')}
                    onClick={() =>
                      editor.chain().focus().toggleBlockquote().run()
                    }
                  >
                    <span className="text-[14px]">❝</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Link"
                    active={editor.isActive('link')}
                    onClick={() => promptLink(editor)}
                  >
                    <span className="text-[13px]">🔗</span>
                  </BubbleBtn>
                </BubbleMenu>
              )}
              {editor && (
                <FloatingMenu
                  editor={editor}
                  className="flex items-center gap-0.5 rounded-lg border border-[#dadce0] bg-white px-1 py-1 shadow-md"
                  shouldShow={({ state }) => {
                    const { $from } = state.selection
                    const isEmpty = state.selection.empty
                    const isParagraph = $from.parent.type.name === 'paragraph'
                    const isLineEmpty = $from.parent.content.size === 0
                    return isEmpty && isParagraph && isLineEmpty
                  }}
                >
                  <BubbleBtn
                    label="Heading 1"
                    onClick={() =>
                      editor.chain().focus().toggleHeading({ level: 1 }).run()
                    }
                  >
                    <span className="text-[12px] font-bold">H1</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Heading 2"
                    onClick={() =>
                      editor.chain().focus().toggleHeading({ level: 2 }).run()
                    }
                  >
                    <span className="text-[12px] font-bold">H2</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Bullet list"
                    onClick={() =>
                      editor.chain().focus().toggleBulletList().run()
                    }
                  >
                    <span className="text-[13px]">•</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Numbered list"
                    onClick={() =>
                      editor.chain().focus().toggleOrderedList().run()
                    }
                  >
                    <span className="text-[12px]">1.</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Quote"
                    onClick={() =>
                      editor.chain().focus().toggleBlockquote().run()
                    }
                  >
                    <span className="text-[13px]">❝</span>
                  </BubbleBtn>
                  <BubbleBtn
                    label="Code block"
                    onClick={() =>
                      editor.chain().focus().toggleCodeBlock().run()
                    }
                  >
                    <span className="text-[12px] font-mono">{'</>'}</span>
                  </BubbleBtn>
                </FloatingMenu>
              )}
              <EditorContent editor={editor} />
            </div>
          </div>

          {/* Footer status */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-[#5f6368]">
            <span>
              {stats.words} {stats.words === 1 ? 'word' : 'words'}
            </span>
            <span className="text-[#dadce0]">·</span>
            <span>
              {stats.chars} {stats.chars === 1 ? 'character' : 'characters'}
            </span>
            <span className="text-[#dadce0]">·</span>
            <span>~{Math.max(1, Math.ceil(stats.words / 200))} min read</span>
            <span className="ml-auto">
              {version === 0 ? 'Not yet saved' : `Last saved version v${version}`}
            </span>
          </div>
          </div>{/* close max-w-[816px] flex-1 */}
        </div>{/* close flex row */}
      </div>{/* close px-4 py-8 */}
    </div>
  )
}

function computeStats(text: string): { words: number; chars: number } {
  const trimmed = text.trim()
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length
  return { words, chars: text.length }
}

function SaveStatusBadge({
  state,
  version,
}: {
  state: SaveState
  version: number
}) {
  const label = (() => {
    switch (state) {
      case 'idle':
        return version === 0 ? 'Not saved yet' : `Saved · v${version}`
      case 'dirty':
        return 'Unsaved changes'
      case 'saving-draft':
        return 'Saving draft…'
      case 'saved-draft':
        return 'Draft saved'
      case 'saving':
        return 'Saving…'
      case 'error':
        return 'Error saving'
    }
  })()
  const tone =
    state === 'error'
      ? 'text-red-600'
      : state === 'dirty'
      ? 'text-amber-600'
      : 'text-[#5f6368]'
  return <span className={`ml-3 text-[12px] ${tone}`}>{label}</span>
}

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryRow[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="h-8 rounded-md border border-[#dadce0] bg-white px-2.5 text-[12.5px] text-[#3c4043] outline-none focus:border-[#059669]"
    >
      <option value="">Uncategorized</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

function Toolbar({
  editor,
  onPickImage,
}: {
  editor: Editor | null
  onPickImage: (file: File) => void
}) {
  const disabled = !editor

  const Btn = ({
    onClick,
    active,
    children,
    label,
  }: {
    onClick: () => void
    active?: boolean
    children: React.ReactNode
    label: string
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        'inline-flex h-8 min-w-[32px] items-center justify-center rounded px-2 text-[13px] font-medium transition-colors disabled:opacity-40 ' +
        (active
          ? 'bg-[rgba(5,150,105,0.1)] text-[#059669]'
          : 'text-[#3c4043] hover:bg-[#f1f3f4]')
      }
    >
      {children}
    </button>
  )

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    Boolean(editor?.isActive(name, attrs))

  return (
    <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-1 px-6 py-1.5">
      <Btn
        label="Undo"
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Icon path="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
      </Btn>
      <Btn
        label="Redo"
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Icon path="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />
      </Btn>
      <Divider />
      <Btn
        label="Heading 1"
        active={isActive('heading', { level: 1 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <span className="text-[13px] font-bold">H1</span>
      </Btn>
      <Btn
        label="Heading 2"
        active={isActive('heading', { level: 2 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="text-[13px] font-bold">H2</span>
      </Btn>
      <Btn
        label="Heading 3"
        active={isActive('heading', { level: 3 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="text-[13px] font-bold">H3</span>
      </Btn>
      <Divider />
      <Btn
        label="Bold (⌘B)"
        active={isActive('bold')}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <span className="text-[14px] font-bold">B</span>
      </Btn>
      <Btn
        label="Italic (⌘I)"
        active={isActive('italic')}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <span className="text-[14px] italic">I</span>
      </Btn>
      <Btn
        label="Underline (⌘U)"
        active={isActive('underline')}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <span className="text-[14px] underline">U</span>
      </Btn>
      <Btn
        label="Strikethrough"
        active={isActive('strike')}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <span className="text-[14px] line-through">S</span>
      </Btn>
      <Btn
        label="Inline code"
        active={isActive('code')}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Icon path="M8 6 2 12l6 6M16 6l6 6-6 6" />
      </Btn>
      <ColorPicker editor={editor} />
      <HighlightPicker editor={editor} />
      <Divider />
      <Btn
        label="Align left"
        active={Boolean(editor?.isActive({ textAlign: 'left' }))}
        onClick={() => editor?.chain().focus().setTextAlign('left').run()}
      >
        <Icon path="M3 6h18M3 12h12M3 18h18" />
      </Btn>
      <Btn
        label="Align center"
        active={Boolean(editor?.isActive({ textAlign: 'center' }))}
        onClick={() => editor?.chain().focus().setTextAlign('center').run()}
      >
        <Icon path="M3 6h18M6 12h12M3 18h18" />
      </Btn>
      <Btn
        label="Align right"
        active={Boolean(editor?.isActive({ textAlign: 'right' }))}
        onClick={() => editor?.chain().focus().setTextAlign('right').run()}
      >
        <Icon path="M3 6h18M9 12h12M3 18h18" />
      </Btn>
      <Btn
        label="Justify"
        active={Boolean(editor?.isActive({ textAlign: 'justify' }))}
        onClick={() => editor?.chain().focus().setTextAlign('justify').run()}
      >
        <Icon path="M3 6h18M3 12h18M3 18h18" />
      </Btn>
      <Divider />
      <Btn
        label="Bullet list"
        active={isActive('bulletList')}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <Icon path="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
      </Btn>
      <Btn
        label="Numbered list"
        active={isActive('orderedList')}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <Icon path="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
      </Btn>
      <Btn
        label="Quote"
        active={isActive('blockquote')}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Icon path="M3 21c3 0 7-1 7-8V5H3v8h4M14 21c3 0 7-1 7-8V5h-7v8h4" />
      </Btn>
      <Btn
        label="Code block"
        active={isActive('codeBlock')}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Icon path="M16 18l6-6-6-6M8 6l-6 6 6 6" />
      </Btn>
      <Btn
        label="Divider"
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Icon path="M5 12h14" />
      </Btn>
      <Divider />
      <ImageButton onPick={onPickImage} />
      <Btn
        label="Link (⌘K)"
        active={isActive('link')}
        onClick={() => editor && promptLink(editor)}
      >
        <Icon path="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </Btn>
      <Btn
        label="Clear formatting"
        onClick={() =>
          editor?.chain().focus().unsetAllMarks().clearNodes().run()
        }
      >
        <Icon path="M3 3l18 18M7 4h10M9 4l-2 16M15 4l-2 16M5 20h14" />
      </Btn>
    </div>
  )
}

function BubbleBtn({
  onClick,
  active,
  children,
  label,
}: {
  onClick: () => void
  active?: boolean
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        'inline-flex h-7 min-w-[28px] items-center justify-center rounded px-2 transition-colors ' +
        (active
          ? 'bg-[rgba(5,150,105,0.1)] text-[#059669]'
          : 'text-[#3c4043] hover:bg-[#f1f3f4]')
      }
    >
      {children}
    </button>
  )
}

function promptLink(editor: Editor) {
  const prev = editor.getAttributes('link').href as string | undefined
  const input = prompt('URL', prev ?? 'https://')
  if (input === null) return
  const url = input.trim()
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) {
    alert('Link must start with http://, https://, mailto:, or /')
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

const TEXT_COLORS = [
  { name: 'Default', value: null },
  { name: 'Gray', value: '#5f6368' },
  { name: 'Red', value: '#d93025' },
  { name: 'Orange', value: '#e8710a' },
  { name: 'Yellow', value: '#bf8f00' },
  { name: 'Green', value: '#137333' },
  { name: 'Blue', value: '#1a73e8' },
  { name: 'Purple', value: '#9334e6' },
] as const

const HIGHLIGHT_COLORS = [
  { name: 'None', value: null },
  { name: 'Yellow', value: '#fff475' },
  { name: 'Green', value: '#ccff90' },
  { name: 'Blue', value: '#aecbfa' },
  { name: 'Pink', value: '#fbcfe8' },
  { name: 'Orange', value: '#fbbc04' },
] as const

function ColorPicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        title="Text color"
        aria-label="Text color"
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 min-w-[32px] items-center justify-center rounded px-2 text-[#3c4043] transition-colors hover:bg-[#f1f3f4] disabled:opacity-40"
      >
        <span className="text-[14px] font-bold underline decoration-red-500 decoration-2">
          A
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 grid grid-cols-4 gap-1 rounded-lg border border-[#dadce0] bg-white p-2 shadow-md">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                title={c.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (c.value === null) editor?.chain().focus().unsetColor().run()
                  else editor?.chain().focus().setColor(c.value).run()
                  setOpen(false)
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#dadce0] hover:scale-105 transition-transform"
                style={{ background: c.value ?? '#fff', color: c.value ? '#fff' : '#3c4043' }}
              >
                {c.value === null ? '×' : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function HighlightPicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        title="Highlight"
        aria-label="Highlight"
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 min-w-[32px] items-center justify-center rounded px-2 text-[#3c4043] transition-colors hover:bg-[#f1f3f4] disabled:opacity-40"
      >
        <span className="rounded bg-[#fff475] px-1 text-[12px] font-bold">A</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 grid grid-cols-3 gap-1 rounded-lg border border-[#dadce0] bg-white p-2 shadow-md">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                title={c.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (c.value === null) editor?.chain().focus().unsetHighlight().run()
                  else editor?.chain().focus().setHighlight({ color: c.value }).run()
                  setOpen(false)
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#dadce0]"
                style={{ background: c.value ?? '#fff' }}
              >
                {c.value === null ? '×' : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ImageButton({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        title="Image"
        aria-label="Insert image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 min-w-[32px] items-center justify-center rounded px-2 text-[#3c4043] transition-colors hover:bg-[#f1f3f4]"
      >
        <Icon path="M3 5h18v14H3zM3 17l5-5 4 4 4-3 5 5" />
      </button>
    </>
  )
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  )
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-[#e8eaed]" />
}
