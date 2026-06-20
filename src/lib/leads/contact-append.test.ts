import { describe, it, expect, vi } from 'vitest'
import { appendLeadContacts, extractContactsFromSubmission } from './contact-append'

function makeAdmin() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  return { rpc } as unknown as Parameters<typeof appendLeadContacts>[0]
}

describe('appendLeadContacts', () => {
  it('forwards phones, emails, and source to the RPC', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', {
      phones: ['+639171234567'],
      emails: ['Jane@Example.com'],
      source: 'messenger',
    })
    const rpc = admin.rpc as ReturnType<typeof vi.fn>
    expect(rpc).toHaveBeenCalledWith('append_lead_contacts', {
      p_lead_id: 'lead-1',
      p_phones: ['+639171234567'],
      p_emails: ['Jane@Example.com'],
      p_source: 'messenger',
    })
  })

  it('defaults source to "manual" when omitted', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', { phones: ['+639171234567'] })
    const rpc = admin.rpc as ReturnType<typeof vi.fn>
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_source: 'manual' })
  })

  it('skips the RPC when both arrays are empty', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', { phones: [], emails: [], source: 'manual' })
    expect((admin.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

describe('extractContactsFromSubmission (form)', () => {
  it('captures a phone field configured as field_kind "number"', () => {
    const config = {
      blocks: [
        { type: 'field', key: 'full_name', field_kind: 'short_text', label: 'Full Name' },
        { type: 'field', key: 'phone_number', field_kind: 'number', label: 'Phone Number' },
        { type: 'field', key: 'email', field_kind: 'email', label: 'Email' },
      ],
    }
    const data = { fields: { full_name: 'Aj Mechanico', phone_number: '+639536350770', email: 'aj@example.com' } }
    const result = extractContactsFromSubmission('form', data, config)
    expect(result.phones).toEqual(['+639536350770'])
    expect(result.emails).toEqual(['aj@example.com'])
  })

  it('captures a PH mobile number from a generically-keyed field', () => {
    const config = { blocks: [{ type: 'field', key: 'field_2', field_kind: 'short_text' }] }
    const data = { fields: { field_2: '09412674563' } }
    expect(extractContactsFromSubmission('form', data, config).phones).toEqual(['09412674563'])
  })

  it('ignores non-phone numbers in generic fields', () => {
    const config = { blocks: [{ type: 'field', key: 'quantity', field_kind: 'number', label: 'Quantity' }] }
    const data = { fields: { quantity: '3' } }
    const result = extractContactsFromSubmission('form', data, config)
    expect(result.phones).toEqual([])
    expect(result.emails).toEqual([])
  })

  it('detects an email by value even when field_kind is generic', () => {
    const config = { blocks: [{ type: 'field', key: 'field_3', field_kind: 'short_text' }] }
    const data = { fields: { field_3: 'Admin@DriveDirect.ph' } }
    expect(extractContactsFromSubmission('form', data, config).emails).toEqual(['admin@drivedirect.ph'])
  })
})

describe('extractContactsFromSubmission (booking + catalog)', () => {
  it('captures a booking phone field', () => {
    const config = { form: { fields: [{ key: 'phone', field_kind: 'phone' }] } }
    const data = { fields: { phone: '09928214519' }, slot_iso: '2026-05-04T01:00:00.000Z' }
    expect(extractContactsFromSubmission('booking', data, config).phones).toEqual(['09928214519'])
  })

  it('captures catalog customer phone and email', () => {
    const data = { customer: { name: 'David', phone: '09292992', email: 'david@example.com' } }
    const result = extractContactsFromSubmission('catalog', data, {})
    expect(result.phones).toEqual(['09292992'])
    expect(result.emails).toEqual(['david@example.com'])
  })
})
