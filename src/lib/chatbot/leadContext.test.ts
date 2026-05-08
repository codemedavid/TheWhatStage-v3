import { describe, expect, it } from 'vitest'
import {
  formatBookings,
  formatOrders,
  formatQualification,
  formatForms,
  renderBlock,
} from './leadContext'

describe('formatBookings', () => {
  it('returns [] when no rows', () => {
    expect(formatBookings([], new Map())).toEqual([])
  })

  it('renders a future booking as Upcoming with stored timezone and title', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const lines = formatBookings(
      [
        {
          id: 'b1',
          submission_id: 'sub-1',
          event_at: future,
          timezone: 'Asia/Manila',
          duration_minutes: 30,
          status: 'scheduled',
        },
      ],
      new Map([['sub-1', 'Discovery Call']]),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^- Upcoming:/)
    expect(lines[0]).toContain('"Discovery Call"')
    expect(lines[0]).toContain('(30 min)')
    expect(lines[0]).toContain('status: scheduled')
  })

  it('renders a past booking as Past', () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const lines = formatBookings(
      [
        {
          id: 'b2',
          submission_id: null,
          event_at: past,
          timezone: 'Asia/Manila',
          duration_minutes: null,
          status: 'completed',
        },
      ],
      new Map(),
    )
    expect(lines[0]).toMatch(/^- Past:/)
    expect(lines[0]).toContain('"appointment"')
    expect(lines[0]).toContain('status: completed')
  })

  it('formats date+time using the booking timezone', () => {
    const iso = '2026-05-15T06:00:00.000Z'
    const lines = formatBookings(
      [
        {
          id: 'b1',
          submission_id: 'sub-1',
          event_at: iso,
          timezone: 'Asia/Manila',
          duration_minutes: 60,
          status: 'scheduled',
        },
      ],
      new Map([['sub-1', 'X']]),
    )
    expect(lines[0]).toMatch(/2:00\s?PM/i)
    expect(lines[0]).toMatch(/May\s+15,\s+2026/)
  })
})

describe('formatOrders', () => {
  it('returns [] when no rows', () => {
    expect(formatOrders([])).toEqual([])
  })

  it('renders verbatim total with currency and item summary', () => {
    const lines = formatOrders([
      {
        id: 'o1',
        status: 'pending',
        payment_status: 'paid',
        currency: 'PHP',
        subtotal_amount: 1250,
        created_at: '2026-04-30T08:00:00.000Z',
        business_order_items: [
          { title_snapshot: 'Tumbler', quantity: 2, unit_amount: 500 },
          { title_snapshot: 'Hat', quantity: 1, unit_amount: 250 },
        ],
      },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('payment: paid')
    expect(lines[0]).toContain('fulfillment: pending')
    expect(lines[0]).toContain('2× Tumbler')
    expect(lines[0]).toContain('1× Hat')
    expect(lines[0]).toMatch(/₱1,250|PHP\s?1,250/)
  })

  it('truncates item lists with a +N more suffix', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      title_snapshot: `Item${i}`,
      quantity: 1,
      unit_amount: 100,
    }))
    const lines = formatOrders([
      {
        id: 'o1',
        status: 'fulfilled',
        payment_status: 'paid',
        currency: 'PHP',
        subtotal_amount: 700,
        created_at: '2026-04-30T08:00:00.000Z',
        business_order_items: items,
      },
    ])
    expect(lines[0]).toContain('+3 more')
  })

  it('handles missing items list and amounts', () => {
    const lines = formatOrders([
      {
        id: 'o1',
        status: 'new',
        payment_status: 'unpaid',
        currency: null,
        subtotal_amount: null,
        created_at: '2026-04-30T08:00:00.000Z',
        business_order_items: null,
      },
    ])
    expect(lines[0]).toContain('total unknown')
    expect(lines[0]).toContain('no item details on file')
  })
})

describe('formatQualification', () => {
  it('shows outcome and never leaks numeric score', () => {
    const lines = formatQualification({
      id: 'q1',
      action_page_id: 'p1',
      outcome: 'qualified',
      data: {
        score: 87,
        answers: [
          { questionId: 'q1', prompt: 'Budget?', kind: 'rating', display: '5 / 5' },
          { questionId: 'q2', prompt: 'Need?', kind: 'text', display: 'Yes' },
        ],
      },
      created_at: '2026-04-15T10:00:00.000Z',
      action_pages: { kind: 'qualification', title: 'Lead Gen Quiz' },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('qualified')
    expect(lines[0]).toContain('"Lead Gen Quiz"')
    expect(lines[0]).toContain('answered 2 questions')
    expect(lines[0]).not.toContain('87')
    expect(lines[0]).not.toMatch(/score/i)
  })

  it('falls back when title and outcome are missing', () => {
    const lines = formatQualification({
      id: 'q1',
      action_page_id: 'p1',
      outcome: null,
      data: { answers: [] },
      created_at: '2026-04-15T10:00:00.000Z',
      action_pages: { kind: 'qualification', title: null },
    })
    expect(lines[0]).toContain('submitted')
    expect(lines[0]).toContain('"qualification form"')
  })
})

describe('formatForms', () => {
  it('returns [] when none', () => {
    expect(formatForms([])).toEqual([])
  })

  it('renders kind and title for each submission', () => {
    const lines = formatForms([
      {
        id: 's1',
        action_page_id: 'p1',
        outcome: 'valid',
        data: {},
        created_at: '2026-03-28T10:00:00.000Z',
        action_pages: { kind: 'form', title: 'Contact Form' },
      },
      {
        id: 's2',
        action_page_id: 'p2',
        outcome: 'valid',
        data: {},
        created_at: '2026-03-20T10:00:00.000Z',
        action_pages: { kind: 'realestate', title: 'Property Inquiry' },
      },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"Contact Form"')
    expect(lines[0]).toContain('(form)')
    expect(lines[1]).toContain('"Property Inquiry"')
    expect(lines[1]).toContain('(realestate)')
  })
})

describe('renderBlock', () => {
  it('always emits all four section headers and closed-world rules', () => {
    const block = renderBlock({
      bookingLines: [],
      orderLines: ['- placed Apr 30, 2026 — total ₱1,250'],
      qualificationLines: [],
      formLines: [],
    })
    expect(block).toContain('Bookings:')
    expect(block).toContain('Orders:')
    expect(block).toContain('Qualification:')
    expect(block).toContain('Form submissions:')
    expect(block).toContain('LEAD CONTEXT — closed-world record')
    expect(block).toContain('only source of truth')
    expect(block).toContain('verbatim')
    expect(block).toContain('Never reveal a numeric qualification score')
    const noneCount = (block.match(/- none on file\./g) ?? []).length
    expect(noneCount).toBe(3)
  })
})
