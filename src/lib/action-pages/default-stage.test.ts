import { describe, expect, it, vi } from 'vitest'
import { getDefaultStageKind, resolveDefaultStageId } from './default-stage'

describe('getDefaultStageKind', () => {
  it('maps qualification outcomes to default stage kinds', () => {
    expect(getDefaultStageKind('qualification', 'qualified')).toBe('qualifying')
    expect(getDefaultStageKind('qualification', 'disqualified')).toBe('lost')
    expect(getDefaultStageKind('qualification', 'pending_review')).toBeNull()
  })

  it('maps non-qualification action page outcomes used by existing pages', () => {
    expect(getDefaultStageKind('booking', 'booked')).toBe('decision')
    expect(getDefaultStageKind('catalog', 'checked_out')).toBe('won')
  })
})

describe('resolveDefaultStageId', () => {
  it('returns the first stage id for the requested kind', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { id: 'stage_1' }, error: null }))
    const limit = vi.fn(() => ({ maybeSingle }))
    const order = vi.fn(() => ({ limit }))
    const eqKind = vi.fn(() => ({ order }))
    const eqUser = vi.fn(() => ({ eq: eqKind }))
    const select = vi.fn(() => ({ eq: eqUser }))
    const admin = { from: vi.fn(() => ({ select })) }

    await expect(resolveDefaultStageId(admin as never, 'user_1', 'qualifying')).resolves.toBe(
      'stage_1',
    )
    expect(admin.from).toHaveBeenCalledWith('pipeline_stages')
    expect(select).toHaveBeenCalledWith('id')
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user_1')
    expect(eqKind).toHaveBeenCalledWith('kind', 'qualifying')
    expect(order).toHaveBeenCalledWith('position', { ascending: true })
    expect(limit).toHaveBeenCalledWith(1)
  })
})
