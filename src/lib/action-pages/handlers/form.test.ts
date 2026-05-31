import { describe, it, expect } from 'vitest'
import { parseFormSubmission } from './form'

const config = {
  theme: {
    background_color: '#ffffff',
    accent_color: '#059669',
    button_text_color: '#ffffff',
  },
  branding: {},
  submit_button_label: 'Submit',
  success_message: 'Thanks!',
  blocks: [
    { id: 'b1', type: 'heading', text: 'Hello', level: 2 },
    { id: 'b2', type: 'description', text: 'About you' },
    {
      id: 'b3',
      type: 'field',
      key: 'full_name',
      label: 'Full name',
      field_kind: 'short_text',
      required: true,
    },
    {
      id: 'b4',
      type: 'field',
      key: 'email',
      label: 'Email',
      field_kind: 'email',
      required: false,
    },
    {
      id: 'b5',
      type: 'field',
      key: 'agreed',
      label: 'I agree',
      field_kind: 'checkbox',
      required: false,
    },
    {
      id: 'b6',
      type: 'field',
      key: 'plan',
      label: 'Plan',
      field_kind: 'select',
      required: false,
      options: [
        { label: 'Free', value: 'free' },
        { label: 'Pro', value: 'pro' },
      ],
    },
    {
      id: 'b7',
      type: 'field',
      key: 'channel',
      label: 'Channel',
      field_kind: 'radio',
      required: false,
      options: [
        { label: 'Email', value: 'email' },
        { label: 'Phone', value: 'phone' },
      ],
    },
  ],
}

describe('parseFormSubmission', () => {
  it('extracts field values from payload, ignoring non-field blocks', () => {
    const result = parseFormSubmission(
      {
        full_name: 'Jane',
        email: 'jane@example.com',
        plan: 'pro',
        channel: 'email',
        agreed: 'true',
        // Heading/description block ids should not appear in fields.
        b1: 'should be ignored',
      },
      config,
    )
    expect(result.outcome).toBe('submitted')
    const fields = (result.data as { fields: Record<string, unknown> }).fields
    expect(fields).toEqual({
      full_name: 'Jane',
      email: 'jane@example.com',
      plan: 'pro',
      channel: 'email',
      agreed: true,
    })
    expect((result.data as Record<string, unknown>).meta).toBeUndefined()
  })

  it('throws when a required field is missing (server-side enforcement)', () => {
    // The handler now rejects rather than recording validation_errors and
    // returning 'submitted' — required fields are enforced on the server.
    expect(() =>
      parseFormSubmission({ email: 'jane@example.com' }, config),
    ).toThrow(/required/i)
  })

  it('rejects select/radio values outside the configured options', () => {
    expect(() =>
      parseFormSubmission({ full_name: 'Jane', plan: 'enterprise' }, config),
    ).toThrow(/selection/i)
    expect(() =>
      parseFormSubmission({ full_name: 'Jane', channel: 'fax' }, config),
    ).toThrow(/selection/i)
  })

  it('rejects malformed email values', () => {
    expect(() =>
      parseFormSubmission({ full_name: 'Jane', email: 'not-an-email' }, config),
    ).toThrow(/email/i)
  })

  it('coerces checkbox values to booleans', () => {
    // full_name is required, so include it to isolate checkbox behavior.
    const truthy = parseFormSubmission({ full_name: 'Jane', agreed: 'on' }, config)
    expect(
      (truthy.data as { fields: Record<string, unknown> }).fields.agreed,
    ).toBe(true)

    const falsy = parseFormSubmission({ full_name: 'Jane', agreed: 'false' }, config)
    expect(
      (falsy.data as { fields: Record<string, unknown> }).fields.agreed,
    ).toBe(false)

    // Missing checkbox value defaults to false (HTML form behavior).
    const missing = parseFormSubmission({ full_name: 'Jane' }, config)
    expect(
      (missing.data as { fields: Record<string, unknown> }).fields.agreed,
    ).toBe(false)
  })

  it('passes valid select and radio values through unchanged', () => {
    const result = parseFormSubmission(
      { full_name: 'Jane', plan: 'free', channel: 'phone' },
      config,
    )
    const fields = (result.data as { fields: Record<string, unknown> }).fields
    expect(fields.plan).toBe('free')
    expect(fields.channel).toBe('phone')
  })

  it('falls back to defaults when config is invalid (no field blocks → no fields)', () => {
    const result = parseFormSubmission(
      { full_name: 'Jane' },
      { not: 'valid' } as Record<string, unknown>,
    )
    expect(result.outcome).toBe('submitted')
    expect(
      (result.data as { fields: Record<string, unknown> }).fields,
    ).toEqual({})
  })
})
