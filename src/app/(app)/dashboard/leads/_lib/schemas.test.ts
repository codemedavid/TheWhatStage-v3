import { describe, it, expect } from 'vitest'
import { LeadInput, StageInput, FieldDefInput, LeadsQuery } from './schemas'

describe('schemas', () => {
  it('accepts a minimal lead', () => {
    const r = LeadInput.parse({
      stage_id: '00000000-0000-0000-0000-000000000000',
      name: 'Jane',
    })
    expect(r.name).toBe('Jane')
  })

  it('rejects empty lead name', () => {
    expect(() =>
      LeadInput.parse({
        stage_id: '00000000-0000-0000-0000-000000000000',
        name: '',
      }),
    ).toThrow()
  })

  it('rejects bad field def key', () => {
    expect(() =>
      FieldDefInput.parse({ key: 'Bad-Key', label: 'x', type: 'text' }),
    ).toThrow()
  })

  it('parses leads query defaults', () => {
    const q = LeadsQuery.parse({})
    expect(q.view).toBe('kanban')
    expect(q.page).toBe(1)
    expect(q.sort).toBe('recent')
  })

  it('rejects bad date', () => {
    expect(() => LeadsQuery.parse({ from: '2025/01/01' })).toThrow()
  })

  it('stage name length bound', () => {
    expect(() => StageInput.parse({ name: '' })).toThrow()
  })
})
