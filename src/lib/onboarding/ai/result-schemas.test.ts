import { describe, expect, it } from 'vitest'
import { parseFormFieldsResult } from './result-schemas'
import type { SuggestedBlock } from './form-fields'

describe('parseFormFieldsResult', () => {
  it('accepts a valid form blocks payload matching runFormFieldsGeneration output', () => {
    const payload = {
      blocks: [
        {
          id: 'b1',
          type: 'field',
          key: 'full_name',
          label: 'Full name',
          field_kind: 'short_text',
          required: true,
        },
        {
          id: 'b2',
          type: 'field',
          key: 'email',
          label: 'Email',
          field_kind: 'email',
          required: true,
        },
      ],
    }
    const result = parseFormFieldsResult(payload)
    expect(result).not.toBeNull()
    expect(result?.blocks).toHaveLength(2)
    expect(result?.blocks[0]).toMatchObject({
      id: 'b1',
      type: 'field',
      key: 'full_name',
      field_kind: 'short_text',
      required: true,
    })
  })

  it('accepts a qualification-style payload with single_choice + options', () => {
    const payload = {
      blocks: [
        {
          id: 'q1',
          type: 'field',
          key: 'budget',
          field_kind: 'single_choice',
          prompt: 'What is your budget?',
          label: 'Budget',
          required: true,
          options: [
            { label: 'Under 10k', value: 'lt10k' },
            { label: '10k-50k', value: '10k-50k' },
          ],
        },
      ],
    }
    const result = parseFormFieldsResult(payload)
    expect(result).not.toBeNull()
    expect(result?.blocks[0].options).toEqual([
      { label: 'Under 10k', value: 'lt10k' },
      { label: '10k-50k', value: '10k-50k' },
    ])
  })

  it('returns a typed SuggestedBlock[] (compile-time check)', () => {
    const payload = {
      blocks: [{ id: 'h1', type: 'heading', text: 'Section A', level: 2 }],
    }
    const result = parseFormFieldsResult(payload)
    expect(result).not.toBeNull()
    // Type narrowing: this assignment proves the return type is SuggestedBlock[]
    const blocks: SuggestedBlock[] | undefined = result?.blocks
    expect(blocks?.[0].type).toBe('heading')
  })

  it('rejects malformed input (block missing required id)', () => {
    const payload = { blocks: [{ type: 'field', key: 'x' }] }
    expect(parseFormFieldsResult(payload)).toBeNull()
  })

  it('rejects payload with invalid block type', () => {
    const payload = {
      blocks: [{ id: 'b1', type: 'paragraph', text: 'nope' }],
    }
    expect(parseFormFieldsResult(payload)).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(parseFormFieldsResult(null)).toBeNull()
    expect(parseFormFieldsResult('hello')).toBeNull()
    expect(parseFormFieldsResult({ blocks: 'not-an-array' })).toBeNull()
  })
})
