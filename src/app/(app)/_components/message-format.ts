/**
 * Messenger-safe text formatting helpers.
 *
 * Messenger renders a small markup subset in plain-text messages, so every
 * transform here stays plain text end-to-end — nothing downstream (template
 * render, send path, storage) needs to know the composer exists.
 *
 *   *bold*   _italic_   ~strikethrough~   `code`
 *   "• " bullets and "1. " numbered lines (plain characters, no markup)
 */

export type WrapMarker = '*' | '_' | '~' | '`'
export type ListMarker = 'bullet' | 'number'

export const BULLET = '• '

export interface Selection {
  value: string
  start: number
  end: number
}

/** Expand a caret-only selection to the whole word it sits in. */
function expandToWord({ value, start, end }: Selection): Selection {
  if (start !== end) return { value, start, end }
  const isWordChar = (c: string) => /[^\s]/.test(c)
  let left = start
  let right = end
  while (left > 0 && isWordChar(value[left - 1])) left -= 1
  while (right < value.length && isWordChar(value[right])) right += 1
  return { value, start: left, end: right }
}

/**
 * Wrap (or unwrap, when already wrapped) the selection in a marker.
 * Returns a new selection — the input is never mutated.
 */
export function toggleWrap(sel: Selection, marker: WrapMarker): Selection {
  const { value, start, end } = expandToWord(sel)
  const selected = value.slice(start, end)

  const isWrappedInside =
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  if (isWrappedInside) {
    const inner = selected.slice(marker.length, selected.length - marker.length)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }

  const isWrappedOutside =
    value.slice(start - marker.length, start) === marker &&
    value.slice(end, end + marker.length) === marker
  if (isWrappedOutside) {
    return {
      value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    }
  }

  const next = `${marker}${selected}${marker}`
  return {
    value: value.slice(0, start) + next + value.slice(end),
    start: start + marker.length,
    end: start + marker.length + selected.length,
  }
}

/** Start index of the line containing `index`. */
function lineStart(value: string, index: number): number {
  const nl = value.lastIndexOf('\n', Math.max(0, index - 1))
  return nl === -1 ? 0 : nl + 1
}

/** End index (exclusive of the newline) of the line containing `index`. */
function lineEnd(value: string, index: number): number {
  const nl = value.indexOf('\n', index)
  return nl === -1 ? value.length : nl
}

const NUMBERED_RE = /^\d+\.\s/

function stripListPrefix(line: string): string {
  if (line.startsWith(BULLET)) return line.slice(BULLET.length)
  const numbered = NUMBERED_RE.exec(line)
  return numbered ? line.slice(numbered[0].length) : line
}

function hasMarker(line: string, marker: ListMarker): boolean {
  return marker === 'bullet' ? line.startsWith(BULLET) : NUMBERED_RE.test(line)
}

/**
 * Prefix every selected line with a bullet / number, or strip the prefixes when
 * all selected lines already carry that marker.
 */
export function toggleList(sel: Selection, marker: ListMarker): Selection {
  const { value, start, end } = sel
  const blockStart = lineStart(value, start)
  const blockEnd = lineEnd(value, end)
  const lines = value.slice(blockStart, blockEnd).split('\n')

  const allMarked = lines.every((l) => l.trim() === '' || hasMarker(l, marker))
  const next = lines
    .map((line, i) => {
      if (line.trim() === '') return line
      const bare = stripListPrefix(line)
      if (allMarked) return bare
      return marker === 'bullet' ? `${BULLET}${bare}` : `${i + 1}. ${bare}`
    })
    .join('\n')

  return {
    value: value.slice(0, blockStart) + next + value.slice(blockEnd),
    start: blockStart,
    end: blockStart + next.length,
  }
}

/**
 * When the caret sits at the end of a list line, Enter continues the list.
 * Returns null when the default newline behaviour should stand.
 */
export function continueList(sel: Selection): Selection | null {
  const { value, start, end } = sel
  if (start !== end) return null
  const from = lineStart(value, start)
  const line = value.slice(from, start)

  if (line.startsWith(BULLET)) {
    if (line.trim() === BULLET.trim()) {
      // Empty bullet — Enter ends the list instead of adding another one.
      return { value: value.slice(0, from) + value.slice(start), start: from, end: from }
    }
    const insert = `\n${BULLET}`
    return { value: value.slice(0, start) + insert + value.slice(start), start: start + insert.length, end: start + insert.length }
  }

  const numbered = NUMBERED_RE.exec(line)
  if (numbered) {
    if (line.slice(numbered[0].length).trim() === '') {
      return { value: value.slice(0, from) + value.slice(start), start: from, end: from }
    }
    const n = Number.parseInt(numbered[0], 10) + 1
    const insert = `\n${n}. `
    return { value: value.slice(0, start) + insert + value.slice(start), start: start + insert.length, end: start + insert.length }
  }

  return null
}

/** Render Messenger markup as HTML for a read-only preview. */
export function formatPreviewHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br />')
}
