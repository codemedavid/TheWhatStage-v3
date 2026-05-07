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
    defaultConfig: {
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      appointment: {
        duration_min: 30,
        buffer_min: 0,
        timezone: 'Asia/Manila',
      },
      // Mon–Fri 09:00–17:00 enabled, weekends off.
      availability: [
        { weekday: 0, enabled: false, windows: [] },
        { weekday: 1, enabled: true, windows: [{ start: '09:00', end: '17:00' }] },
        { weekday: 2, enabled: true, windows: [{ start: '09:00', end: '17:00' }] },
        { weekday: 3, enabled: true, windows: [{ start: '09:00', end: '17:00' }] },
        { weekday: 4, enabled: true, windows: [{ start: '09:00', end: '17:00' }] },
        { weekday: 5, enabled: true, windows: [{ start: '09:00', end: '17:00' }] },
        { weekday: 6, enabled: false, windows: [] },
      ],
      date_range: { from: null, to: null },
      slots_per_window: 1,
      form: {
        mode: 'inline',
        fields: [
          {
            id: 'full_name',
            key: 'full_name',
            label: 'Full name',
            field_kind: 'short_text',
            required: true,
          },
          {
            id: 'phone',
            key: 'phone',
            label: 'Phone',
            field_kind: 'phone',
            required: true,
          },
        ],
      },
    },
    defaultPipelineRules: [{ outcome: 'booked', reason: 'Appointment booked' }],
  },
  qualification: {
    id: 'qualification',
    label: 'Qualification',
    blurb: 'Short quiz that scores leads as qualified or not.',
    supportsEmbed: true,
    defaultConfig: {
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [
        {
          id: 'q_starter',
          prompt: 'Are you the decision maker?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [
            { label: 'Yes', value: 'yes', score: 1 },
            { label: 'No', value: 'no', score: 0 },
          ],
        },
      ],
      scoring: {
        mode: 'rule_based',
        threshold: 1,
        qualified_outcome: 'qualified',
        disqualified_outcome: 'disqualified',
      },
      intro: { headline: '', body: '' },
      outro: {
        qualified_message: '',
        disqualified_message: '',
        pending_message: '',
      },
    },
    defaultPipelineRules: [
      { outcome: 'qualified', reason: 'Passed qualification' },
      { outcome: 'disqualified', reason: 'Did not qualify' },
      { outcome: 'pending_review', reason: 'Awaiting manual qualification review' },
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
    defaultConfig: {
      theme: { accent_color: '#059669' },
      product_ids: [],
      categories: [],
      checkout_fields: [],
    },
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
