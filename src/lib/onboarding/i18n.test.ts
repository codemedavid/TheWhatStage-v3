import { describe, expect, it } from 'vitest'
import { t, LANG_COOKIE, readLangFromCookie } from './i18n'

describe('t', () => {
  it('returns Tagalog by default', () => {
    expect(t('welcome.title', 'tl')).toBe('Tara, i-setup natin yung bot mo')
  })

  it('returns English when lang=en', () => {
    expect(t('welcome.title', 'en')).toBe("Let's set up your bot")
  })
})

describe('readLangFromCookie', () => {
  it('returns "tl" when cookie missing', () => {
    expect(readLangFromCookie(undefined)).toBe('tl')
  })

  it('returns "en" when cookie = "en"', () => {
    expect(readLangFromCookie('en')).toBe('en')
  })

  it('returns "tl" when cookie has unknown value', () => {
    expect(readLangFromCookie('jp')).toBe('tl')
  })

  it('cookie name is ws_onboarding_lang', () => {
    expect(LANG_COOKIE).toBe('ws_onboarding_lang')
  })
})
