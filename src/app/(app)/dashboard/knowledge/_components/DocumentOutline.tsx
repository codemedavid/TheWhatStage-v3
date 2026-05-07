'use client'
import { useEffect, useState, useTransition } from 'react'

type Heading = { id: string; level: 1 | 2 | 3; text: string; index: number }

// Walk Tiptap JSON to extract headings. We assign each heading an index
// (its order in the doc) and use that to find the matching DOM node.
export function DocumentOutline({ json }: { json: unknown }) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    startTransition(() => setHeadings(extractHeadings(json)))
  }, [json, startTransition])

  // Highlight the heading currently scrolled into view.
  useEffect(() => {
    if (headings.length === 0) return
    const onScroll = () => {
      const nodes = document.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')
      let idx: number | null = null
      for (let i = 0; i < nodes.length; i++) {
        const top = nodes[i].getBoundingClientRect().top
        if (top < 140) idx = i
        else break
      }
      setActiveIdx(idx)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [headings])

  if (headings.length === 0) {
    return (
      <div className="text-[12px] text-[#9aa0a6]">
        Add headings (H1, H2, H3) to build an outline.
      </div>
    )
  }

  return (
    <nav aria-label="Document outline" className="space-y-0.5">
      {headings.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() => scrollToHeading(h.index)}
          className={
            'block w-full truncate rounded px-2 py-1 text-left text-[12.5px] transition-colors ' +
            (activeIdx === h.index
              ? 'bg-[rgba(5,150,105,0.1)] font-medium text-[#059669]'
              : 'text-[#3c4043] hover:bg-[#f1f3f4]') +
            ' ' +
            (h.level === 2 ? 'pl-4' : h.level === 3 ? 'pl-6' : '')
          }
          title={h.text}
        >
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </nav>
  )
}

type ProseMirrorNode = {
  type: string
  attrs?: { level?: number }
  content?: ProseMirrorNode[]
  text?: string
}

function nodeText(node: ProseMirrorNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(nodeText).join('')
}

function extractHeadings(json: unknown): Heading[] {
  if (!json || typeof json !== 'object') return []
  const root = json as ProseMirrorNode
  const out: Heading[] = []
  let idx = 0
  for (const child of root.content ?? []) {
    if (child.type === 'heading') {
      const level = (child.attrs?.level ?? 1) as 1 | 2 | 3
      out.push({
        id: `h-${idx}`,
        level,
        text: nodeText(child).trim(),
        index: idx,
      })
      idx++
    }
  }
  return out
}

function scrollToHeading(index: number) {
  const nodes = document.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')
  const target = nodes[index]
  if (!target) return
  // Account for the sticky chrome (~96px).
  const top = target.getBoundingClientRect().top + window.scrollY - 110
  window.scrollTo({ top, behavior: 'smooth' })
}
