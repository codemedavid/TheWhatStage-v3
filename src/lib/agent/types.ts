// Shared types for the AI follow-up agent pipeline.

export interface ParsedIntent {
  audience: {
    stage_name: string | null
    last_active_within_days: number | null
  }
  instruction: string
  tone: 'friendly' | 'casual' | 'professional'
  ambiguities: string[]
}

export interface AudienceLead {
  id: string
  name: string | null
  custom_fields: Record<string, unknown>
  user_id: string
  thread_id: string
  psid: string
  last_inbound_at: string | null
  page_id: string
  page_access_token: string
}

export interface BulkContext {
  lastInboundByThread: Map<string, string>
  optinByThread: Map<string, { opted_out_at: string | null }>
  otnByThread: Map<string, { token: string; requested_at: string }>
  cooldownThreadIds: Set<string>
  dailyCapUsed: number
  // Per-customer (lead_id) project AI-instructions, used to align the draft to
  // the active project for that customer. Empty when the lead has no project.
  projectInstructionsByLead: Map<string, string>
}

export type PolicyResult =
  | { policy: 'RESPONSE' }
  | { policy: 'MARKETING_MESSAGE' }
  | { policy: 'OTN'; token: string }
  | { policy: 'paused'; reason: 'cooldown' | 'window' | 'optin' | 'cap' }

export interface DraftRow {
  lead_id: string
  thread_id: string
  name: string | null
  draft: string
  policy: PolicyResult
  policy_label: string
}
