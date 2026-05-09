import { describe, expect, it } from 'vitest'
import { renderTemplateVariables, type LeadForRender } from './render'

const baseLead: LeadForRender = {
  name: 'Sarah Cruz',
  custom_fields: { city: 'Manila' },
}

describe('renderTemplateVariables — existing rules (regression)', () => {
  it('renders static and lead_field variables', () => {
    const out = renderTemplateVariables(
      {
        '1': { kind: 'lead_field', field: 'name' },
        '2': { kind: 'static', text: 'Welcome' },
        '3': { kind: 'lead_field', field: 'city' },
      },
      3,
      baseLead,
    )
    expect(out).toEqual(['Sarah Cruz', 'Welcome', 'Manila'])
  })
})

describe('renderTemplateVariables — booking_field', () => {
  const lead: LeadForRender = {
    ...baseLead,
    booking: {
      event_at: '2026-06-01T01:00:00Z',
      event_at_relative: 'in 24 hours',
      title: 'Sunset Villa viewing',
    },
  }

  it('resolves event_at_relative', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'event_at_relative' } },
      1,
      lead,
    )
    expect(out).toEqual(['in 24 hours'])
  })

  it('resolves title', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'title' } },
      1,
      lead,
    )
    expect(out).toEqual(['Sunset Villa viewing'])
  })

  it('returns empty string when booking context is missing', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'title' } },
      1,
      baseLead,
    )
    expect(out).toEqual([''])
  })
})

describe('renderTemplateVariables — property_field', () => {
  const lead: LeadForRender = {
    ...baseLead,
    property: {
      title: 'Sunset Villa',
      address: '123 Coastal Rd',
      price: 'PHP 25M',
      deeplink_url: 'https://example.com/p/sunset-villa',
    },
  }

  it('resolves title and price', () => {
    const out = renderTemplateVariables(
      {
        '1': { kind: 'property_field', field: 'title' },
        '2': { kind: 'property_field', field: 'price' },
      },
      2,
      lead,
    )
    expect(out).toEqual(['Sunset Villa', 'PHP 25M'])
  })

  it('returns empty string when property context is missing', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'property_field', field: 'title' } },
      1,
      baseLead,
    )
    expect(out).toEqual([''])
  })
})
