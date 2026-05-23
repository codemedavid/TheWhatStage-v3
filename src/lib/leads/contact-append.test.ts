import { describe, it, expect, vi } from 'vitest'
import { appendLeadContacts } from './contact-append'

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
