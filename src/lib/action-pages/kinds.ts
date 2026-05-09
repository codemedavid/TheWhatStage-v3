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
  /** Default `cta_label` — the Messenger CTA button label the bot uses when sending this page. */
  defaultCtaLabel: string
  /** Default `notification_template.text` — Messenger echo sent back after a successful submission. */
  defaultNotificationText: string
  /**
   * When true, the action-page editor renders the booking follow-up
   * touchpoints section. Currently only booking; realestate joins in Phase 4.
   */
  supportsFollowups?: boolean
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
    defaultCtaLabel: 'Open form',
    defaultNotificationText:
      "Thanks! We got your details and will be in touch shortly.",
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
    defaultCtaLabel: 'Book a slot',
    supportsFollowups: true,
    defaultNotificationText:
      "You're booked! We'll send a reminder before your appointment.",
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
    defaultCtaLabel: 'Start qualification',
    defaultNotificationText:
      "Thanks for answering! We'll review your responses and follow up shortly.",
  },
  sales: {
    id: 'sales',
    label: 'Sales Page',
    blurb: 'Offer page with product details, gallery, and embedded conversion forms.',
    supportsEmbed: false,
    defaultConfig: {
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      product: {
        name: '',
        type: 'digital',
        headline: '',
        tagline: '',
        description: '',
      },
      price: {
        amount: null,
        currency: 'PHP',
        compare_at_amount: null,
        display_label: '',
        period: null,
      },
      gallery: [],
      features: [],
      benefits: [],
      testimonials: [],
      faqs: [],
      guarantee: { enabled: false, title: '', body: '' },
      cta: {
        primary_label: 'Get it now',
        secondary_label: '',
        scroll_target: 'inline_form',
      },
      delivery: { type: 'email', notes: '' },
      social_proof: [],
      linked_action_page_ids: [],
      fallback_form: {
        enabled: true,
        fields: [
          { key: 'full_name', label: 'Your name', required: true, enabled: true },
          { key: 'email', label: 'Email', required: true, enabled: true },
          { key: 'phone', label: 'Phone', required: false, enabled: true },
          { key: 'message', label: 'Message', required: false, enabled: false },
        ],
        submit_button_label: 'Buy now',
        success_message: "Thanks! We'll be in touch shortly.",
      },
    },
    defaultPipelineRules: [
      { outcome: 'submitted', reason: 'Lead submitted via sales page' },
      { outcome: 'checked_out', reason: 'Sales page checkout' },
    ],
    defaultCtaLabel: 'View offer',
    defaultNotificationText:
      "Thanks for your interest! We'll follow up with the next steps shortly.",
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
    defaultCtaLabel: 'Browse catalog',
    defaultNotificationText:
      "Thanks for your order! We'll confirm the details on Messenger shortly.",
  },
  realestate: {
    id: 'realestate',
    label: 'Property',
    blurb: 'Property listing with photos, map, financing, and linked action pages.',
    supportsEmbed: false,
    defaultConfig: {
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#0F766E',
        button_text_color: '#FFFFFF',
      },
      status: 'for_sale',
      price: {
        amount: null,
        currency: 'PHP',
        period: null,
        display_label: '',
      },
      gallery: [],
      address: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postal: '',
        country: '',
      },
      description: '',
      specs: {
        property_type: null,
        beds: null,
        baths: null,
        floor_area: null,
        lot_area: null,
        year_built: null,
        parking: null,
      },
      custom_specs: [],
      amenities: [],
      financing_options: [],
      financing_notes: '',
      linked_action_page_ids: [],
    },
    defaultPipelineRules: [
      { outcome: 'inquiry_submitted', reason: 'Property inquiry submitted' },
      { outcome: 'viewing_booked', reason: 'Viewing booked' },
    ],
    defaultCtaLabel: 'View property',
    defaultNotificationText:
      "Thanks for your inquiry! We'll reach out about this property shortly.",
  },
}

export function isActionPageKind(value: unknown): value is ActionPageKind {
  return typeof value === 'string' && (ACTION_PAGE_KINDS as readonly string[]).includes(value)
}
