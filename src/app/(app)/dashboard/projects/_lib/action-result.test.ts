import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { SequenceInput } from './schemas'
import { describeActionError, type ActionResult } from './action-result'

describe('describeActionError', () => {
  it('turns an over-long Do rule into a specific, human-readable message', () => {
    // Arrange — the exact shape that used to throw an opaque, masked
    // "Server Components render" error from the save action.
    const parsed = SequenceInput.safeParse({
      stage_id: '00000000-0000-0000-0000-000000000000',
      enabled: true,
      do_rules: ['ok', 'x'.repeat(1001)],
      dont_rules: [],
      steps: [],
    })
    expect(parsed.success).toBe(false)

    // Act
    const msg = describeActionError((parsed as { error: ZodError }).error)

    // Assert — names the offending field so the user knows what to shorten.
    expect(msg).toContain('Do rule #2')
    expect(msg.toLowerCase()).toContain('1000')
  })

  it('labels an over-long step instruction by its position', () => {
    const parsed = SequenceInput.safeParse({
      stage_id: '00000000-0000-0000-0000-000000000000',
      enabled: true,
      do_rules: [],
      dont_rules: [],
      steps: [{ delay_minutes: 5, instruction: 'a'.repeat(2001) }],
    })
    expect(parsed.success).toBe(false)
    const msg = describeActionError((parsed as { error: ZodError }).error)
    expect(msg).toContain('Step #1 instruction')
  })

  it('accepts a Do rule up to 1000 characters (cap was raised from 280)', () => {
    const parsed = SequenceInput.safeParse({
      stage_id: '00000000-0000-0000-0000-000000000000',
      enabled: true,
      do_rules: ['x'.repeat(1000)],
      dont_rules: [],
      steps: [],
    })
    expect(parsed.success).toBe(true)
  })

  it('falls back to a PostgREST-style error message', () => {
    const msg = describeActionError({ message: 'duplicate key value violates unique constraint' })
    expect(msg).toBe('duplicate key value violates unique constraint')
  })

  it('returns a generic message for unknown errors', () => {
    expect(describeActionError(null)).toMatch(/something went wrong/i)
  })

  it('preserves the discriminated result type at compile time', () => {
    const ok: ActionResult<{ seeded: number }> = { ok: true, seeded: 3 }
    const err: ActionResult<{ seeded: number }> = { ok: false, error: 'nope' }
    expect(ok.ok && ok.seeded).toBe(3)
    expect(!err.ok && err.error).toBe('nope')
  })
})
