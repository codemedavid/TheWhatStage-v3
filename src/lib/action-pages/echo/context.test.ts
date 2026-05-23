import { describe, expect, it, vi } from 'vitest'
import { buildEchoContext } from './context'

interface MockTable {
  leads?: { id: string; name: string | null; email: string | null; phone: string | null } | null
  threads?: { id: string; full_name: string | null } | null
  payment_methods?: { id: string; label: string } | null
}

function makeAdmin(rows: MockTable) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.leads ?? null, error: null }) }),
          }),
        }
      }
      if (table === 'messenger_threads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.threads ?? null, error: null }) }),
          }),
        }
      }
      if (table === 'payment_methods') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.payment_methods ?? null, error: null }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  } as never
}

const PAGE_FORM = {
  id: 'ap_1',
  user_id: 'u_1',
  kind: 'form' as const,
  slug: 'welcome',
  config: {},
  notification_template: null,
}

describe('buildEchoContext', () => {
  it('resolves fb.name from messenger_threads.full_name', async () => {
    const admin = makeAdmin({ threads: { id: 't_1', full_name: 'Maria Santos' } })
    const { ctx, known } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: null,
      threadId: 't_1',
      psid: 'PSID_1',
      fbPageId: 'fbp_1',
    })
    expect((ctx as { fb: { name: string } }).fb.name).toBe('Maria Santos')
    expect(known.has('fb.name')).toBe(true)
  })

  it('resolves lead.* from the leads row', async () => {
    const admin = makeAdmin({
      leads: { id: 'l_1', name: 'Maria', email: 'm@x.com', phone: '+639' },
    })
    const { ctx } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: 'l_1',
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { lead: { name: string; email: string; phone: string } }).lead).toEqual({
      name: 'Maria',
      email: 'm@x.com',
      phone: '+639',
    })
  })

  it('builds customer.* from parsed.data.customer for catalog', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: { ...PAGE_FORM, kind: 'catalog' },
      parsed: {
        outcome: 'checked_out',
        data: {
          customer: { name: 'Ana', phone: '+1', email: '', notes: 'asap' },
        },
      },
      catalogOrder: null,
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { customer: Record<string, string> }).customer).toEqual({
      name: 'Ana',
      phone: '+1',
      email: '',
      notes: 'asap',
    })
  })

  it('builds order.* from catalogOrder', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: { ...PAGE_FORM, kind: 'catalog' },
      parsed: { outcome: 'checked_out', data: {} },
      catalogOrder: {
        orderId: 'o1',
        currency: 'PHP',
        subtotal: 3700,
        customer: { name: null, phone: null, email: null, notes: null },
        customFields: {},
        paymentStatus: 'unpaid',
        lines: [
          { business_item_id: 'b1', title_snapshot: 'Heavy Duty Helmet', quantity: 1, unit_amount: 2500, line_total_amount: 2500, currency: 'PHP' },
          { business_item_id: 'b2', title_snapshot: 'Flashlight', quantity: 4, unit_amount: 300, line_total_amount: 1200, currency: 'PHP' },
        ],
      },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    const order = (ctx as { order: Record<string, unknown> }).order
    expect(order.items).toBe('1x Heavy Duty Helmet, 4x Flashlight')
    expect(order.items_lines).toContain('• 1x Heavy Duty Helmet')
    expect(order.items_lines).toContain('• 4x Flashlight')
    expect(order.subtotal).toMatch(/₱3,700/)
    expect(order.total).toMatch(/₱3,700/)
    expect(order.currency).toBe('PHP')
    expect(order.count).toBe('5')
  })

  it('builds booking.* using the page timezone', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: {
        ...PAGE_FORM,
        kind: 'booking',
        config: { appointment: { timezone: 'Asia/Manila', duration_min: 30 } },
      },
      parsed: {
        outcome: 'booked',
        data: { slot_iso: '2026-05-28T06:30:00Z', fields: {} },
      },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    const booking = (ctx as { booking: Record<string, string> }).booking
    expect(booking.date).toMatch(/May 28, 2026/)
    expect(booking.time).toMatch(/2:30/)
    expect(booking.datetime).toContain('at')
    expect(booking.duration).toBe('30 min')
  })

  it('exposes custom.* keys from page config', async () => {
    const admin = makeAdmin({})
    const { ctx, known, customKeys } = await buildEchoContext({
      admin,
      page: {
        ...PAGE_FORM,
        kind: 'catalog',
        config: {
          checkout_fields: [
            { key: 'address', label: 'Address', type: 'long_text' },
            { key: 'gift_note', label: 'Gift', type: 'short_text' },
          ],
        },
      },
      parsed: {
        outcome: 'checked_out',
        data: { customer: { custom: { address: '123 Main', gift_note: 'Happy bday' } } },
      },
      catalogOrder: null,
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect(customKeys).toEqual(['address', 'gift_note'])
    expect(known.has('custom.address')).toBe(true)
    expect((ctx as { custom: Record<string, string> }).custom.address).toBe('123 Main')
  })

  it('produces empty strings for unresolvable lookups but does not throw', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { fb: { name: string } }).fb.name).toBe('')
    expect((ctx as { lead: { name: string } }).lead.name).toBe('')
  })
})
