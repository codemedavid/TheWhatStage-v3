import { describe, expect, test } from 'vitest'
import { BULLET, continueList, formatPreviewHtml, toggleList, toggleWrap } from './message-format'

describe('toggleWrap', () => {
  test('wraps the selected range in the marker', () => {
    // Arrange
    const sel = { value: 'hello world', start: 6, end: 11 }

    // Act
    const next = toggleWrap(sel, '*')

    // Assert
    expect(next.value).toBe('hello *world*')
    expect(next.value.slice(next.start, next.end)).toBe('world')
  })

  test('expands a caret-only selection to the surrounding word', () => {
    const next = toggleWrap({ value: 'hello world', start: 8, end: 8 }, '_')
    expect(next.value).toBe('hello _world_')
  })

  test('unwraps when the markers sit just outside the selection', () => {
    const next = toggleWrap({ value: 'hello *world*', start: 7, end: 12 }, '*')
    expect(next.value).toBe('hello world')
    expect(next.value.slice(next.start, next.end)).toBe('world')
  })

  test('unwraps when the markers are inside the selection', () => {
    const next = toggleWrap({ value: 'hello *world*', start: 6, end: 13 }, '*')
    expect(next.value).toBe('hello world')
  })

  test('leaves the original selection object untouched', () => {
    const sel = { value: 'hi', start: 0, end: 2 }
    toggleWrap(sel, '~')
    expect(sel).toEqual({ value: 'hi', start: 0, end: 2 })
  })
})

describe('toggleList', () => {
  test('prefixes every selected line with a bullet', () => {
    const next = toggleList({ value: 'one\ntwo', start: 0, end: 7 }, 'bullet')
    expect(next.value).toBe(`${BULLET}one\n${BULLET}two`)
  })

  test('numbers lines sequentially', () => {
    const next = toggleList({ value: 'one\ntwo\nthree', start: 0, end: 13 }, 'number')
    expect(next.value).toBe('1. one\n2. two\n3. three')
  })

  test('strips the prefix when every selected line already has it', () => {
    const next = toggleList({ value: `${BULLET}one\n${BULLET}two`, start: 0, end: 10 }, 'bullet')
    expect(next.value).toBe('one\ntwo')
  })

  test('converts a bulleted block to a numbered one', () => {
    const next = toggleList({ value: `${BULLET}one\n${BULLET}two`, start: 0, end: 10 }, 'number')
    expect(next.value).toBe('1. one\n2. two')
  })

  test('operates on the caret line when nothing is selected', () => {
    const next = toggleList({ value: 'one\ntwo', start: 5, end: 5 }, 'bullet')
    expect(next.value).toBe(`one\n${BULLET}two`)
  })
})

describe('continueList', () => {
  test('adds the next bullet on Enter', () => {
    const value = `${BULLET}one`
    const next = continueList({ value, start: value.length, end: value.length })
    expect(next?.value).toBe(`${BULLET}one\n${BULLET}`)
  })

  test('increments the number on Enter', () => {
    const value = '1. one'
    const next = continueList({ value, start: value.length, end: value.length })
    expect(next?.value).toBe('1. one\n2. ')
  })

  test('ends the list when the current item is empty', () => {
    const value = `${BULLET}one\n${BULLET}`
    const next = continueList({ value, start: value.length, end: value.length })
    expect(next?.value).toBe(`${BULLET}one\n`)
  })

  test('returns null on a plain line so the default newline stands', () => {
    expect(continueList({ value: 'plain', start: 5, end: 5 })).toBeNull()
  })

  test('returns null when text is selected', () => {
    expect(continueList({ value: `${BULLET}one`, start: 0, end: 3 })).toBeNull()
  })
})

describe('formatPreviewHtml', () => {
  test('renders the Messenger markup subset', () => {
    expect(formatPreviewHtml('*a* _b_ ~c~ `d`')).toBe(
      '<strong>a</strong> <em>b</em> <s>c</s> <code>d</code>',
    )
  })

  test('escapes HTML before formatting', () => {
    expect(formatPreviewHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  test('turns newlines into line breaks', () => {
    expect(formatPreviewHtml('a\nb')).toBe('a<br />b')
  })
})
