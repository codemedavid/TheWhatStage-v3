import { describe, expect, it } from 'vitest'
import { hasTimeMarker } from './hasTimeMarker'

describe('hasTimeMarker', () => {
  const positives = [
    'follow up tomorrow',
    'follow up later po',
    'message me at 2pm',
    'follow up Wednesday',
    'chat me back on May 12',
    'ping me sa Lunes',
    'follow up mamaya',
    'kausapin mo ako bukas',
    'follow up next Monday morning',
    "I'll be free at 3:30 PM, ping me then",
    'free ako on July 4',
    'balikan mo ako sa Miyerkules ng hapon',
    'sa Sabado ng umaga',
    "let's talk tonight",
    'try me again sa Linggo',
  ]

  const negatives = [
    'how much po?',
    'thanks!',
    'haha sige',
    'pwede pa po ba?',
    'gusto ko po malaman ang price',
    'di ko alam',
    'okay lang',
    "I'll think about it",
  ]

  it.each(positives)('returns true for: %s', (msg) => {
    expect(hasTimeMarker(msg)).toBe(true)
  })

  it.each(negatives)('returns false for: %s', (msg) => {
    expect(hasTimeMarker(msg)).toBe(false)
  })

  it('handles empty input', () => {
    expect(hasTimeMarker('')).toBe(false)
    expect(hasTimeMarker('   ')).toBe(false)
  })
})
