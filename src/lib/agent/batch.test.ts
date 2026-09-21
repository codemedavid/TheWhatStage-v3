import { describe, expect, it, vi } from 'vitest'
import { chunk, fetchAllPages, fetchByIdChunks } from './batch'

describe('chunk', () => {
  it('splits a list into fixed-size groups with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns an empty list for empty input', () => {
    expect(chunk([], 3)).toEqual([])
  })

  it('throws when size is not positive', () => {
    expect(() => chunk([1], 0)).toThrow(/size must be > 0/)
  })
})

describe('fetchAllPages', () => {
  it('keeps requesting pages until a short page arrives', async () => {
    // Arrange: 2 full pages of 3, then a page of 1.
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const fetchPage = vi.fn(async (from: number, to: number) => rows.slice(from, to + 1))

    // Act
    const all = await fetchAllPages(fetchPage, 3)

    // Assert
    expect(all).toEqual(rows)
    expect(fetchPage.mock.calls).toEqual([[0, 2], [3, 5], [6, 8]])
  })

  it('stops after a single page when the result fits', async () => {
    const fetchPage = vi.fn(async () => ['only'])
    expect(await fetchAllPages(fetchPage, 1000)).toEqual(['only'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('makes one extra request when the last page is exactly full', async () => {
    const fetchPage = vi.fn(async (from: number) => (from === 0 ? ['a', 'b'] : []))
    expect(await fetchAllPages(fetchPage, 2)).toEqual(['a', 'b'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})

describe('fetchByIdChunks', () => {
  it('splits ids across several queries and concatenates the rows', async () => {
    const fetchChunk = vi.fn(async (ids: string[]) => ids.map((id) => ({ id })))
    const rows = await fetchByIdChunks(['1', '2', '3', '4', '5'], fetchChunk, 2)
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5'])
    expect(fetchChunk).toHaveBeenCalledTimes(3)
  })

  it('does not query at all for an empty id list', async () => {
    const fetchChunk = vi.fn(async () => [])
    expect(await fetchByIdChunks([], fetchChunk)).toEqual([])
    expect(fetchChunk).not.toHaveBeenCalled()
  })
})
