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
  /** Default `bot_send_instructions` — kind-aware "send when" guidance pre-filled on create. */
  defaultBotSendInstructions: string
  /** Default `status` on create. Sales pages stay `'draft'` until product fields are filled. */
  defaultStatusOnCreate: 'draft' | 'published'
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
      'Thanks {{fb.name || customer.name || "there"}}! We got your details and will be in touch shortly.',
    defaultBotSendInstructions:
      "Send when the customer agrees to share their details, asks how to sign up, asks to be added to the list / contacted, or says things like 'pa-fill out', 'saan po mag-register', 'paano sumali'. If they've expressed interest but haven't said yes to sharing info yet, confirm with one short question first.",
    defaultStatusOnCreate: 'published',
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
      'Hi {{fb.name || customer.name || "there"}}, you\'re booked for {{booking.date}} at {{booking.time}}. We\'ll follow up shortly.',
    defaultBotSendInstructions:
      "Send when the customer asks to book, schedule, reserve, or set an appointment, asks about your availability ('kelan po available', 'anong oras', 'pwede ba bukas'), or agrees to set a time after the offer has been discussed. Don't send on a cold first inbound — make sure they've shown interest in meeting first.",
    defaultStatusOnCreate: 'published',
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
      'Thanks {{fb.name || "there"}}! We\'ll review your answers and follow up shortly.',
    defaultBotSendInstructions:
      "Send after the customer has shown interest in the offer but before pricing or booking, when you still need to confirm fit (decision maker, budget, timeline, team size, use case). Don't send on the very first inbound — collect at least one signal of interest first, then use this to qualify them.",
    defaultStatusOnCreate: 'published',
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
    ],
    defaultCtaLabel: 'View offer',
    defaultNotificationText:
      'Thanks {{fb.name || customer.name || "there"}}! We got your details for {{sales.product}}. We\'ll be in touch shortly.',
    defaultBotSendInstructions:
      "Send when the customer asks what we offer, asks for details, features, inclusions, or pricing of the offer, asks 'paano' / 'how does it work', asks to see the package, or says they want to try it. If they haven't shown any interest yet, qualify with one short question (what they're looking for, their use case) before sending.",
    // Sales pages render awkwardly with empty product fields, so keep them as
    // drafts on create. The "Make Live or Keep Draft" modal at save time still
    // nudges users to publish once they've filled the page in.
    defaultStatusOnCreate: 'draft',
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
      'Order received!\n{{order.items_lines}}\n\nTotal: {{order.total}}\nName: {{customer.name}}\nPhone: {{customer.phone}}\n\nThanks for your order — we\'ll confirm on Messenger shortly.',
    defaultBotSendInstructions:
      "Send when the customer asks about a product, asks for the price, asks what we sell, says they're looking for an item, asks about availability or stock, asks for recommendations, or shows buying intent ('pabili po', 'magkano', 'meron ba kayo…', 'do you have…', 'pwede pa-quote', 'patingin ng items'). If they haven't said what they need yet, ask one short clarifying question first.",
    defaultStatusOnCreate: 'published',
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
      'Thanks for your interest in {{property.title}}! We\'ll reach out about this property shortly.',
    defaultBotSendInstructions:
      "Send when the customer asks about a property, asks for the price, specs, location, financing, or floor area, asks 'meron ba kayong [type/location]', says they want to view a unit, or expresses interest in a specific area or property type. If they haven't given a location, budget, or property type yet, ask one of those first.",
    defaultStatusOnCreate: 'published',
  },
}

export function isActionPageKind(value: unknown): value is ActionPageKind {
  return typeof value === 'string' && (ACTION_PAGE_KINDS as readonly string[]).includes(value)
}
