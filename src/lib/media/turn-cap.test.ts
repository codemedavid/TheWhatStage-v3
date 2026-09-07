import { describe, expect, it } from 'vitest'
import { capMediaPerTurn } from './turn-cap'

const img = (id: string) => ({ id, mimeType: 'image/png' })
const vid = (id: string) => ({ id, mimeType: 'video/mp4' })
const aud = (id: string) => ({ id, mimeType: 'audio/mpeg' })

describe('capMediaPerTurn', () => {
  it('keeps every image up to the total cap', () => {
    const out = capMediaPerTurn([img('1'), img('2'), img('3')], { maxTotal: 2 })
    expect(out.map((a) => a.id)).toEqual(['1', '2'])
  })

  it('allows only one voice or video per turn, keeping the highest-priority one', () => {
    const out = capMediaPerTurn([vid('v1'), aud('a1'), vid('v2')], { maxTotal: 4 })
    expect(out.map((a) => a.id)).toEqual(['v1'])
  })

  it('mixes one AV asset with images while preserving order', () => {
    const out = capMediaPerTurn([img('1'), aud('a1'), img('2'), vid('v1')], { maxTotal: 4 })
    expect(out.map((a) => a.id)).toEqual(['1', 'a1', '2'])
  })

  it('returns an empty list for no candidates', () => {
    expect(capMediaPerTurn([], { maxTotal: 4 })).toEqual([])
  })
})
