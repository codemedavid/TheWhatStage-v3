import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCoalescedCallback } from '@/lib/coalesce'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useAuth } from '@/providers/auth'
import { threadKeys } from './threads'
import type {
  LeadContactValue,
  LeadFieldDef,
  LeadRow,
  LeadStageEvent,
  PipelineStage,
} from './types'

const LEAD_SELECT =
  'id, stage_id, name, email, phone, company, job_title, source, notes, estimated_value, custom_fields, phones, emails, position, score, entered_stage_at, last_activity_at, created_at, updated_at, messenger_threads(picture_url, unread_count, missed_count)'

const LIST_LIMIT = 300
const BOARD_LIMIT = 500
// Recent-contact window backing the call list's ordering and subtitles. Big
// enough to cover every lead a LIST_LIMIT page can show; the lead profile
// queries its own contacts in full, so nothing is hidden by this cap.
const CONTACT_INDEX_LIMIT = 1_000
const LEADS_REFRESH_WINDOW_MS = 2_500

export const leadKeys = {
  all: ['leads'] as const,
  stages: ['leads', 'stages'] as const,
  fields: ['leads', 'fields'] as const,
  list: (q: string, reachableOnly: boolean) => ['leads', 'list', q, reachableOnly] as const,
  board: ['leads', 'board'] as const,
  one: (id: string) => ['leads', 'one', id] as const,
  events: (id: string) => ['leads', 'events', id] as const,
  contacts: (id: string) => ['leads', 'contacts', id] as const,
  contactIndex: ['leads', 'contact-index'] as const,
}

export function useStages() {
  return useQuery({
    queryKey: leadKeys.stages,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, name, position, kind, is_default, is_terminal')
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as PipelineStage[]
    },
  })
}

export function useFieldDefs() {
  return useQuery({
    queryKey: leadKeys.fields,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_field_defs')
        .select('id, key, label, type, options, position')
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as LeadFieldDef[]
    },
  })
}

// A lead is worth calling if we hold any phone/email for them — either a
// captured value in the phones[]/emails[] arrays or one an operator typed into
// the official column. Separate .or() calls are ANDed by PostgREST, so this
// composes with the search filter.
const REACHABLE_FILTER =
  'phones.neq.{},emails.neq.{},phone.not.is.null,email.not.is.null'

export function useLeads(search: string, reachableOnly: boolean) {
  const q = search.trim()
  return useQuery({
    queryKey: leadKeys.list(q, reachableOnly),
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select(LEAD_SELECT)
        .order('last_activity_at', { ascending: false })
        .limit(LIST_LIMIT)
      if (reachableOnly) query = query.or(REACHABLE_FILTER)
      if (q) {
        const safe = q.replace(/[%,()"]/g, ' ')
        query = query.or(
          `name.ilike."%${safe}%",email.ilike."%${safe}%",phone.ilike."%${safe}%",company.ilike."%${safe}%"`,
        )
      }
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as LeadRow[]
    },
  })
}

/** Every lead for the kanban, grouped client-side by stage. */
export function useLeadBoard() {
  return useQuery({
    queryKey: leadKeys.board,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .order('position', { ascending: true })
        .order('last_activity_at', { ascending: false })
        .limit(BOARD_LIMIT)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as LeadRow[]
    },
  })
}

export function useLead(leadId: string | undefined) {
  return useQuery({
    queryKey: leadKeys.one(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .eq('id', leadId!)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as LeadRow | null
    },
  })
}

export function useLeadStageEvents(leadId: string | undefined) {
  return useQuery({
    queryKey: leadKeys.events(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, created_at')
        .eq('lead_id', leadId!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as LeadStageEvent[]
    },
  })
}

/**
 * Every phone/email captured for one lead, newest first — including values the
 * lead only typed into a chat and nobody promoted to the official Phone field.
 */
export function useLeadContacts(leadId: string | undefined) {
  return useQuery({
    queryKey: leadKeys.contacts(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_contact_values')
        .select('id, lead_id, kind, value, source, collected_at')
        .eq('lead_id', leadId!)
        .order('collected_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as LeadContactValue[]
    },
  })
}

/**
 * The most recent contact values across the whole account, newest first. Feeds
 * the leads list's ordering and per-row phone line in a single query, instead of
 * one lookup per visible lead. RLS scopes the read to the signed-in user.
 */
export function useLeadContactIndex() {
  return useQuery({
    queryKey: leadKeys.contactIndex,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_contact_values')
        .select('id, lead_id, kind, value, source, collected_at')
        .order('collected_at', { ascending: false })
        .limit(CONTACT_INDEX_LIMIT)
      if (error) throw new Error(error.message)
      return (data ?? []) as LeadContactValue[]
    },
  })
}

export type LeadPatch = Partial<
  Pick<LeadRow, 'name' | 'email' | 'phone' | 'company' | 'job_title' | 'source' | 'notes' | 'estimated_value' | 'custom_fields'>
>

export function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, patch }: { leadId: string; patch: LeadPatch }) => {
      const { error } = await supabase.from('leads').update(patch).eq('id', leadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.all }),
  })
}

/** Audited move through the server (writes lead_stage_events). Optimistic on the board. */
export function useMoveLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, toStageId }: { leadId: string; toStageId: string }) => {
      const res = await api.moveLead(leadId, toStageId)
      if (!res.ok) throw new Error(res.error)
    },
    onMutate: async ({ leadId, toStageId }) => {
      await qc.cancelQueries({ queryKey: leadKeys.board })
      const prev = qc.getQueryData<LeadRow[]>(leadKeys.board)
      qc.setQueryData<LeadRow[]>(leadKeys.board, (rows) =>
        rows?.map((l) => (l.id === leadId ? { ...l, stage_id: toStageId } : l)),
      )
      qc.setQueryData<LeadRow | null>(leadKeys.one(leadId), (l) =>
        l ? { ...l, stage_id: toStageId } : l,
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(leadKeys.board, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: threadKeys.all })
    },
  })
}

/** Board/list stay live as leads change stage from the web or the bot. */
export function useLeadsRealtime() {
  const qc = useQueryClient()
  const { userId } = useAuth()
  // The board pulls up to BOARD_LIMIT leads, so a refetch per row change is far
  // too expensive on a busy account. Bursts collapse into one refresh.
  const schedule = useCoalescedCallback(
    () => qc.invalidateQueries({ queryKey: leadKeys.all }),
    LEADS_REFRESH_WINDOW_MS,
  )

  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`leads:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` },
        schedule,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [schedule, userId])
}
