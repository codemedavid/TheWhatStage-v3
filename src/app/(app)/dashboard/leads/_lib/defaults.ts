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
    description: 'Lead said hi but has not asked anything specific yet. Pure greeting / vague curiosity only.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Pure greeting only: "hi", "hello", "kamusta", "good am/pm", "uy", or a reaction/sticker.',
      'Vague identification with no product specifics: "ano \'to?", "sino kayo?", "page nyo ba \'to?", "first time ko makita".',
      'Generic brand curiosity with zero product detail: "ano ginagawa nyo?", "what do you sell?", "ano offer nyo?".',
    ],
    exit_signals: [
      'Mentions ANY product, variant, color, size, model, service, or buying action — leave immediately.',
      'States interest ("interested po", "interesado ako", "PM po", "I\'m interested", "gusto ko").',
      'Asks about price, stock, availability, location, schedule, or process.',
      'Requests a sample, demo, menu, quote, brochure, or catalog.',
      'Volunteers qualifying info (budget, timeline, decision-maker, location).',
    ],
    required_fields: [],
  },
  {
    name: 'Interested',
    description: 'Actively evaluating — stated interest, asked product specifics, asked price/availability/logistics, or asked multiple questions about the offer.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Explicitly states interest in ANY language: "interested po", "interesado ako", "I\'m interested", "gusto ko", "type ko", "sana mapasaakin", "pa-reserve", "sali ako".',
      'Sends "PM", "pm po", "pminfo", or "PM po details" — Meta-page convention for "send me details = I want to buy".',
      'Asks any price-shaped question: "magkano", "how much", "presyo", "tag", "range", "starting", "budget", "promo", "discount", "sale", "COD", "GCash", "installment", "payment terms".',
      'Asks about stock, size, color, variant, model, or restock — with or without prior pricing.',
      'Asks logistics or process questions: location, branch, store hours, delivery, pickup, shipping fee, how to order, how to avail, schedule, booking, "saan kayo", "kelan available", "open pa ba".',
      'Requests proof: sample, demo, swatch, fit, video, actual photo, unit visit, brochure, menu, catalog, price list, "pa-try", "may sample ba".',
      'Asks 2+ product-specific questions in one message OR 3+ across the thread (volume + depth = evaluating).',
      'Asks about payment methods, installment, refund/return policy, or warranty (post-purchase concerns indicate purchase intent).',
    ],
    exit_signals: [
      'Commits to buy/book ("sige, kunin ko na", "order na ako", "I\'ll take it", "go na ako").',
      'Asks how to reserve / down / book / pay ("paano mag-reserve?", "saan ako magbabayad?").',
      'Sends proof of payment, GCash reference, deposit slip, or screenshot.',
      'Commits a date for purchase, pickup, or meeting ("Friday kukunin ko", "next week ako magbabayad").',
      'Submits a qualification form with qualified outcome.',
      'Raises a clear objection (price, timing, trust, competitor).',
      'Hard reject ("not interested", "ayaw na", "hindi na po ituloy") — moves to Lost.',
    ],
    required_fields: [],
  },
  {
    name: 'Qualified',
    description: 'Confirmed fit — committed to buy/book, requested a proposal, completed a qualification form, or sent payment proof.',
    isDefault: false,
    kind: 'qualifying',
    entry_signals: [
      'Completed qualification form with qualified outcome.',
      'Commits to buy/book in chat: "sige, kunin ko na", "order na ako", "I\'ll take it", "go na ako", "tara, ituloy na natin".',
      'Asks how to reserve, pay, or down-payment: "paano mag-reserve?", "saan ako magbabayad?", "ano account number?".',
      'Sends proof of payment, GCash reference number, deposit slip, or payment screenshot.',
      'Commits a specific date for purchase, pickup, delivery, or decision meeting ("Friday kukunin ko", "next week ako magbabayad", "Monday meeting natin").',
      'Names a decision-maker proactively ("kakausapin ko muna asawa ko, sige Friday balita ko").',
      'Requested a proposal, quote, contract, invoice, terms, or formal paperwork.',
      'Asks delivery cost or address confirmation TO their address ("Antipolo, magkano ship?").',
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
      'Price objection: "mahal naman", "ang mahal", "may discount po ba?", "too expensive", "wants a discount".',
      'Timing objection: "not now", "next time", "next month pa", "need to think about it", "isipin ko muna".',
      'Competitor mention: names a competitor, alternative offer, or "may iba akong tinitingnan".',
      'Trust concern: legitimacy, reviews, refunds, "totoo ba \'to?", "scam ba?", "may proof?".',
      'Waiting on someone else: "kakausapin ko muna asawa ko", "tatanungin ko muna boss ko".',
    ],
    exit_signals: [
      'Resolution: "okay, let\'s proceed", "sige, push natin", "tuloy na po", or similar positive commitment.',
      'Asks a forward-moving question (next steps, payment, scheduling) after the objection.',
      'Schedules a call, demo, or payment.',
      'Hard reject ("not interested", "ayaw na", "hindi na po ituloy", "no thanks", "unsubscribe") — moves to Lost.',
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
      'Explicit disengage in any language: "no thanks", "not interested", "ayaw na", "hindi na po", "hindi na po ituloy", "kinansel ko na", "nag-change mind ako", "remove me", "unsubscribe".',
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
