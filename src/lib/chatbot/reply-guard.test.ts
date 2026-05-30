import { describe, expect, it } from 'vitest'
import { guardReply } from '@/lib/chatbot/reply-guard'

const FALLBACK = 'Sorry, I cannot share that information right now.'

describe('guardReply — contact leak detection', () => {
  it('drops a reply containing a phone number NOT in grounding', () => {
    const result = guardReply({
      text: 'Please call us at 09171234567 for more info.',
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(true)
    expect(result.text).toBe(FALLBACK)
  })

  it('drops a reply containing a URL NOT in grounding', () => {
    const result = guardReply({
      text: 'Visit https://external-site.com/offer to learn more.',
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(true)
    expect(result.text).toBe(FALLBACK)
  })

  it('drops a reply containing an email NOT in grounding', () => {
    const result = guardReply({
      text: 'Email us at support@example.com anytime.',
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(true)
    expect(result.text).toBe(FALLBACK)
  })

  it('passes a clean reply unchanged', () => {
    const clean = 'Hi! We are open Monday to Saturday from 9am to 6pm.'
    const result = guardReply({
      text: clean,
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toBe(clean)
  })

  it('allows a phone number that IS present in grounding', () => {
    const text = 'You can reach us at 09171234567.'
    const result = guardReply({
      text,
      grounding: 'Contact: 09171234567',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toBe(text)
  })

  it('allows a URL that IS present in grounding', () => {
    const text = 'Fill out the form at https://mysite.com/contact.'
    const result = guardReply({
      text,
      grounding: 'Form link: https://mysite.com/contact',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toBe(text)
  })

  it('allows an email that IS present in grounding', () => {
    const text = 'Send your inquiry to hello@mybusiness.ph.'
    const result = guardReply({
      text,
      grounding: 'Email us at hello@mybusiness.ph',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toBe(text)
  })
})

describe('guardReply — dash normalization', () => {
  it('converts em dashes to commas', () => {
    const result = guardReply({
      text: 'We offer Studio—Deluxe—Suite options.',
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toContain(',')
    expect(result.text).not.toContain('—')
  })

  it('converts en dashes to commas', () => {
    const result = guardReply({
      text: 'Available Monday–Friday.',
      grounding: '',
      fallbackMessage: FALLBACK,
    })
    expect(result.dropped).toBe(false)
    expect(result.text).toContain(',')
    expect(result.text).not.toContain('–')
  })
})
