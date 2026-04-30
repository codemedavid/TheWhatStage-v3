export const ACTION_PAGE_KINDS = [
  'form',
  'booking',
  'qualification',
  'sales',
  'catalog',
  'realestate',
] as const

export type ActionPageKind = (typeof ACTION_PAGE_KINDS)[number]

export interface KindMeta {
  id: ActionPageKind
  label: string
  blurb: string
  supportsEmbed: boolean
  defaultConfig: Record<string, unknown>
  defaultPipelineRules: { outcome: string; reason: string }[]
}

export const KIND_REGISTRY: Record<ActionPageKind, KindMeta> = {
  form: {
    id: 'form',
    label: 'Form',
    blurb: 'Collect structured info from a lead. Embeddable or standalone.',
    supportsEmbed: true,
    defaultConfig: {
      theme: {
        background_color: '#ffffff',
        accent_color: '#059669',
        button_text_color: '#ffffff',
      },
      branding: {},
      blocks: [
        {
          id: 'starter-heading',
          type: 'heading',
          text: 'Tell us about yourself',
          level: 2,
        },
        {
          id: 'starter-name',
          type: 'field',
          key: 'full_name',
          label: 'Your name',
          field_kind: 'short_text',
          required: true,
        },
      ],
      submit_button_label: 'Submit',
      success_message: 'Thanks! We got your submission.',
    },
    defaultPipelineRules: [{ outcome: 'submitted', reason: 'Form submitted' }],
  },
  booking: {
    id: 'booking',
    label: 'Booking',
    blurb: 'Let leads pick an appointment slot. Embeddable or standalone.',
    supportsEmbed: true,
    defaultConfig: { duration_min: 30, slots: [] },
    defaultPipelineRules: [{ outcome: 'booked', reason: 'Appointment booked' }],
  },
  qualification: {
    id: 'qualification',
    label: 'Qualification',
    blurb: 'Short quiz that scores leads as qualified or not.',
    supportsEmbed: true,
    defaultConfig: { questions: [], pass_threshold: 0 },
    defaultPipelineRules: [
      { outcome: 'qualified', reason: 'Passed qualification' },
      { outcome: 'disqualified', reason: 'Did not qualify' },
    ],
  },
  sales: {
    id: 'sales',
    label: 'Sales Page',
    blurb: 'Pre-templated offer page with a single call-to-action.',
    supportsEmbed: false,
    defaultConfig: { headline: '', subhead: '', cta_label: 'Buy now' },
    defaultPipelineRules: [{ outcome: 'checked_out', reason: 'Sales page checkout' }],
  },
  catalog: {
    id: 'catalog',
    label: 'Product Catalog',
    blurb: 'E-commerce style listing with cart and checkout.',
    supportsEmbed: false,
    defaultConfig: { products: [], currency: 'PHP' },
    defaultPipelineRules: [{ outcome: 'checked_out', reason: 'Catalog checkout' }],
  },
  realestate: {
    id: 'realestate',
    label: 'Real Estate',
    blurb: 'Property listing with viewing-appointment request.',
    supportsEmbed: false,
    defaultConfig: { property: {}, viewing_slots: [] },
    defaultPipelineRules: [{ outcome: 'viewing_booked', reason: 'Viewing booked' }],
  },
}

export function isActionPageKind(value: unknown): value is ActionPageKind {
  return typeof value === 'string' && (ACTION_PAGE_KINDS as readonly string[]).includes(value)
}
