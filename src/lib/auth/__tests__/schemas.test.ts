import { describe, expect, it } from 'vitest'
import { signUpSchema, signInSchema } from '../schemas'

describe('signUpSchema', () => {
  it('accepts valid input and lowercases email', () => {
    const out = signUpSchema.parse({
      full_name: '  Ada Lovelace  ',
      email: 'Ada@Example.COM',
      password: 'hunter12a',
    })
    expect(out).toEqual({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'hunter12a',
    })
  })

  it('rejects password without a digit', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: 'abcdefgh',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password without a letter', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: '12345678',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password under 8 chars', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: 'abc1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty full_name after trim', () => {
    const r = signUpSchema.safeParse({
      full_name: '   ',
      email: 'a@b.co',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects full_name over 80 chars', () => {
    const r = signUpSchema.safeParse({
      full_name: 'a'.repeat(81),
      email: 'a@b.co',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects bad email', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'not-an-email',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })
})

describe('signInSchema', () => {
  it('accepts and lowercases email', () => {
    const out = signInSchema.parse({ email: 'A@B.CO', password: 'whatever1' })
    expect(out).toEqual({ email: 'a@b.co', password: 'whatever1' })
  })

  it('rejects empty password', () => {
    const r = signInSchema.safeParse({ email: 'a@b.co', password: '' })
    expect(r.success).toBe(false)
  })
})
