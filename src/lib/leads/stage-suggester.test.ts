import { describe, it, expect, vi } from 'vitest'
import { buildSuggesterPrompt, parseSuggesterOutput } from './stage-suggester'

describe('buildSuggesterPrompt', () => {
  it('includes every stage with its signals and the knowledge summary', () => {
    const prompt = buildSuggesterPrompt({
      stages: [
        { id: 's1', name: 'Interested', kind: 'nurture', description: 'd', entry_signals: ['asked price'], exit_signals: ['booked'], required_fields: [] },
      ],
      knowledge: {
        offers: ['Premium tier — ₱5000/mo'],
        faqs: ['Do you ship internationally? Yes.'],
        qualification_criteria: ['Budget ≥ ₱3000/mo'],
        tags: ['saas', 'monthly'],
      },
    })
    expect(prompt).toContain('Interested')
    expect(prompt).toContain('asked price')
    expect(prompt).toContain('Premium tier')
    expect(prompt).toContain('Do you ship internationally')
  })
})

describe('parseSuggesterOutput', () => {
  it('returns suggestions when JSON is valid', () => {
    const json = JSON.stringify({
      suggestions: [
        {
          stage_id: 's1',
          field: 'entry_signals',
          proposed_value: ['asked price', 'asked about premium tier specifically'],
          reason: 'knowledge mentions Premium tier as a buying signal',
        },
      ],
    })
    expect(parseSuggesterOutput(json)).toHaveLength(1)
  })

  it('rejects unknown fields', () => {
    const json = JSON.stringify({
      suggestions: [
        { stage_id: 's1', field: 'random_field', proposed_value: [], reason: 'x' },
      ],
    })
    expect(parseSuggesterOutput(json)).toEqual([])
  })
})
