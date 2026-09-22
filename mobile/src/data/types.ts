// Row shapes as read from Supabase. Only the columns the app touches.

import type { SavedButton, SavedCard, SavedLayout } from '@/lib/saved-message-template'

export interface PipelineStage {
  id: string
  name: string
  position: number
  kind: string
  is_default: boolean
  is_terminal: boolean | null
}

export interface ThreadCounts {
  picture_url: string | null
  unread_count: number
  missed_count: number
}

export interface LeadRow {
  id: string
  stage_id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  source: string | null
  notes: string | null
  estimated_value: number | string | null
  custom_fields: Record<string, unknown>
  /** Every phone/email ever captured for this lead, official or not. Maintained
   *  by append_lead_contacts alongside the per-value lead_contact_values log. */
  phones: string[] | null
  emails: string[] | null
  position: number
  score: number | null
  entered_stage_at: string
  last_activity_at: string
  created_at: string
  updated_at: string
  // PostgREST embeds may arrive as object | array | null.
  messenger_threads?: ThreadCounts | ThreadCounts[] | null
}

export type ContactKind = 'phone' | 'email'
export type ContactSource = 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'

/** One phone/email as we captured it, with where and when it came from. */
export interface LeadContactValue {
  id: string
  lead_id: string
  kind: ContactKind
  value: string
  source: ContactSource
  collected_at: string
}

export interface LeadFieldDef {
  id: string
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options: unknown
  position: number
}

export interface LeadStageEvent {
  id: string
  from_stage_id: string | null
  to_stage_id: string
  source: string
  reason: string | null
  created_at: string
}

export interface ThreadRow {
  id: string
  lead_id: string | null
  full_name: string | null
  picture_url: string | null
  unread_count: number
  missed_count: number
  is_important: boolean
  auto_reply_enabled: boolean
  bot_paused_until: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  leads?: { name: string; stage_id: string } | { name: string; stage_id: string }[] | null
  facebook_pages?: { name: string } | { name: string }[] | null
}

export type MessageSender = 'user' | 'bot' | 'operator'

/** One rendered button on a sent message, as the timeline records it. */
export interface MessageAttachmentButton {
  label: string
  url?: string
}

export interface MessageAttachmentCard {
  title: string
  subtitle?: string
  image_url?: string
  buttons?: MessageAttachmentButton[]
}

export interface MessageAttachment {
  type?: string
  url?: string
  name?: string
  payload?: { url?: string }
  action_page_id?: string
  storage_path?: string
  media_asset_id?: string
  /** 'buttons': what the recipient sees under the text. */
  buttons?: MessageAttachmentButton[]
  /** 'card': the cards that were sent, in order. */
  cards?: MessageAttachmentCard[]
}

export interface MessageRow {
  id: string
  thread_id: string
  direction: 'inbound' | 'outbound'
  sender: MessageSender
  body: string
  attachments: MessageAttachment[] | Record<string, unknown> | null
  error: string | null
  fb_message_id: string | null
  created_at: string
}

export interface Workspace {
  id: string
  name: string
  description: string | null
  position: number
  is_default: boolean
  color: string | null
}

export interface ProjectStage {
  id: string
  workspace_id: string
  name: string
  position: number
  is_default: boolean
  kind: 'open' | 'won' | 'lost' | null
  color: string | null
}

export interface ProjectRow {
  id: string
  workspace_id: string
  lead_id: string
  stage_id: string
  title: string
  description: string | null
  value: number | string | null
  currency: string
  notes: string | null
  position: number
  archived_at: string | null
  created_at: string
  updated_at: string
  project_stages?: { name: string; kind: string | null } | { name: string; kind: string | null }[] | null
  leads?:
    | { name: string; email: string | null; phone: string | null; messenger_threads?: ThreadCounts | ThreadCounts[] | null }
    | { name: string; email: string | null; phone: string | null; messenger_threads?: ThreadCounts | ThreadCounts[] | null }[]
    | null
}

export interface ProjectStageEvent {
  id: string
  from_stage_id: string | null
  to_stage_id: string
  source: string
  reason: string | null
  created_at: string
}

export interface SavedMessage {
  id: string
  title: string
  body: string
  shortcut: string | null
  position: number
  /** Which Messenger layout this sends as. See lib/saved-message-template.ts. */
  layout: SavedLayout
  /** Buttons under the text, for the 'buttons' layout. */
  buttons: SavedButton[]
  /** Cards, for the 'card' and 'carousel' layouts. */
  cards: SavedCard[]
}

export interface SubmissionRow {
  id: string
  action_page_id: string
  lead_id: string | null
  psid: string | null
  outcome: string | null
  data: Record<string, unknown>
  created_at: string
  leads?: { name: string } | { name: string }[] | null
  action_pages?: ActionPageRef | ActionPageRef[] | null
}

export interface ActionPageRef {
  title: string
  kind: string
  slug: string
}

/** One row of the `action_page_submission_stats` RPC. */
export interface ActionPageStat {
  action_page_id: string
  title: string
  kind: string
  status: string
  submissions: number
  /** Submissions that were a real page fill (chat-implied rows excluded). */
  filled: number
  people: number
  last_at: string | null
}

/** Flatten a PostgREST embed that may be object | array | null. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}
