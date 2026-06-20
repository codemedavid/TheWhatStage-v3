import { describe, expect, it } from 'vitest'
import { changePasswordSchema, changeEmailSchema } from './account-schemas'

describe('changePasswordSchema', () => {
  const valid = {
    current_password: 'oldpass1234',
    new_password: 'newpass1234',
    confirm_password: 'newpass1234',
  }

  it('accepts a strong new password that matches its confirmation', () => {
    const res = changePasswordSchema.safeParse(valid)
    expect(res.success).toBe(true)
  })

  it('requires the current password', () => {
    const res = changePasswordSchema.safeParse({ ...valid, current_password: '' })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'current_password')).toBe(true)
    }
  })

  it('rejects a new password that is too short', () => {
    const res = changePasswordSchema.safeParse({
      current_password: 'oldpass1234',
      new_password: 'short1',
      confirm_password: 'short1',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'new_password')).toBe(true)
    }
  })

  it('rejects a new password with no number', () => {
    const res = changePasswordSchema.safeParse({
      current_password: 'oldpass1234',
      new_password: 'onlyletters',
      confirm_password: 'onlyletters',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'new_password')).toBe(true)
    }
  })

  it('rejects when confirmation does not match the new password', () => {
    const res = changePasswordSchema.safeParse({ ...valid, confirm_password: 'different1234' })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'confirm_password')).toBe(true)
    }
  })

  it('rejects when the new password equals the current password', () => {
    const res = changePasswordSchema.safeParse({
      current_password: 'samepass1234',
      new_password: 'samepass1234',
      confirm_password: 'samepass1234',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'new_password')).toBe(true)
    }
  })
})

describe('changeEmailSchema', () => {
  it('accepts a valid email and lowercases it', () => {
    const res = changeEmailSchema.safeParse({ email: 'New@Example.com' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.email).toBe('new@example.com')
  })

  it('rejects an invalid email', () => {
    const res = changeEmailSchema.safeParse({ email: 'not-an-email' })
    expect(res.success).toBe(false)
  })
})
