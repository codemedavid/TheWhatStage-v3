import type { PipelineStageKind } from '@/lib/action-pages/default-stage'

export type DefaultStage = {
  name: string
  description: string
  isDefault: boolean
  kind: PipelineStageKind | 'objection'
  entry_signals: string[]
  exit_signals: string[]
  required_fields: string[]
}

export const DEFAULT_STAGES: DefaultStage[] = [
  {
    name: 'New Lead',
    description: 'Freshly captured from any source. No inbound message yet.',
    isDefault: true,
    kind: 'entry',
    entry_signals: [
      'Lead record was just created from any source (form, ad, manual import).',
      'No inbound message exists from the lead yet.',
    ],
    exit_signals: ['Lead sends any inbound message.'],
    required_fields: [],
  },
  {
    name: 'Engaged',
    description: 'Lead has started talking but has not shown buying intent yet.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Lead sent at least one inbound message.',
      'Greeting, generic question ("hello", "kamusta", "what is this"), or acknowledgment.',
      'Asking about the business, brand, or general offerings without specifying price or buying details.',
    ],
    exit_signals: [
      'Asks a concrete buying question (price, stock, availability, schedule).',
      'Requests a sample, demo, menu, or quote.',
      'Volunteers qualifying info (budget, timeline, decision-maker).',
    ],
    required_fields: [],
  },
  {
    name: 'Interested',
    description: 'Actively evaluating — buying questions, requests for samples, follow-ups after pricing is shared.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Asked about price, stock, or availability ("magkano", "how much", "available ba").',
      'Asked about delivery, scheduling, location, or process AFTER pricing or offer was shared.',
      'Requested a sample, demo, menu, brochure, or catalog.',
      'Asked product-specific or service-specific clarifying questions tied to a purchase decision.',
    ],
    exit_signals: [
      'Confirms budget + timing + decision-maker (verbally or via form).',
      'Submits a qualification form with qualified outcome.',
      'Raises a clear objection (price, timing, trust, competitor).',
      'Books a slot or pays.',
    ],
    required_fields: [],
  },
  {
    name: 'Qualified',
    description: 'Confirmed fit — said yes to budget/timing/decision-maker or completed a qualifying form.',
    isDefault: false,
    kind: 'qualifying',
    entry_signals: [
      'Completed qualification form with qualified outcome.',
      'Explicitly confirmed budget AND timing AND decision-maker in chat.',
      'Requested a proposal or quote.',
      'Asked for next-step paperwork (contract, terms, invoice).',
    ],
    exit_signals: [
      'Proposal or quote sent.',
      'Booking confirmed.',
      'Raises an objection after qualification.',
      'No inbound for 7+ days.',
    ],
    required_fields: [],
  },
  {
    name: 'Objection',
    description: 'Side-track stage. Raised a blocking concern but has not rejected. Will return to previous active stage on resolution.',
    isDefault: false,
    kind: 'objection',
    entry_signals: [
      'Says price is too high, expensive, or wants a discount.',
      'Says "not now", "next time", or "need to think about it".',
      'Mentions a competitor or alternative they are considering.',
      'Raises a trust concern (legitimacy, reviews, refunds).',
      'Says they are waiting on someone else to decide.',
    ],
    exit_signals: [
      'Resolution: "okay, let\'s proceed", "sige, push natin", or similar positive commitment.',
      'Asks a forward-moving question (next steps, payment, scheduling) after the objection.',
      'Schedules a call, demo, or payment.',
      'Hard reject ("not interested", "no thanks", "unsubscribe") — moves to Lost.',
    ],
    required_fields: [],
  },
  {
    name: 'Proposal / Booked',
    description: 'Proposal, quote, or booking is on the table. Awaiting decision.',
    isDefault: false,
    kind: 'decision',
    entry_signals: [
      'Proposal or quote was sent.',
      'Booking confirmed by lead or by action page.',
      'Cart created or order link sent.',
    ],
    exit_signals: [
      'Payment received → Won.',
      'Explicitly declines → Lost.',
      '14 days of silence → Dormant (handled by sweeper).',
    ],
    required_fields: [],
  },
  {
    name: 'Won',
    description: 'Closed-won deal. Payment confirmed or order checked out.',
    isDefault: false,
    kind: 'won',
    entry_signals: [
      'Payment confirmed by action page or manual entry.',
      'Order checked out.',
      'Deal explicitly closed-won by user.',
    ],
    exit_signals: [],
    required_fields: [],
  },
  {
    name: 'Lost',
    description: 'Closed-lost. Explicit no, hard reject, or disqualification outcome.',
    isDefault: false,
    kind: 'lost',
    entry_signals: [
      'Explicit "no thanks", "not interested", "unsubscribe".',
      'Disqualification form outcome.',
      'Hard reject following an Objection.',
    ],
    exit_signals: [],
    required_fields: [],
  },
  {
    name: 'Dormant',
    description: 'Active lead that has gone quiet for 14+ days. Auto-detected daily; returns to previous active stage when they reply.',
    isDefault: false,
    kind: 'dormant',
    entry_signals: [
      'No inbound message for 14+ days in any non-terminal stage past New Lead.',
    ],
    exit_signals: [
      'Lead replies → return to previous active stage via previous_stage_id.',
    ],
    required_fields: [],
  },
]
