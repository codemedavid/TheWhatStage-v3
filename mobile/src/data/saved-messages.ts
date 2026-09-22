import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  CARDS_MAX,
  TITLE_MAX,
  maxCardsFor,
  textMaxFor,
  usesCards,
  validateSavedMessage,
  type SavedButton,
  type SavedCard,
  type SavedLayout,
} from '@/lib/saved-message-template'
import type { SavedMessage } from './types'

export const savedKeys = {
  all: ['saved-messages'] as const,
  one: (id: string) => ['saved-messages', id] as const,
}

export const SAVED_TITLE_MAX = TITLE_MAX

const SELECT = 'id, title, body, shortcut, position, layout, buttons, cards'

export interface SavedMessageInput {
  id?: string
  title: string
  body: string
  shortcut?: string | null
  layout: SavedLayout
  buttons: SavedButton[]
  cards: SavedCard[]
}

export function normalizeShortcut(raw: string | null | undefined): string | null {
  return raw?.trim().toLowerCase().replace(/^\//, '') || null
}

/** PostgREST returns jsonb as-is; be defensive about a row written elsewhere. */
function normalizeRow(row: SavedMessage): SavedMessage {
  return {
    ...row,
    layout: row.layout ?? 'text',
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    cards: Array.isArray(row.cards) ? row.cards : [],
  }
}

/**
 * The line that stands in for a saved message in a list. A card message keeps
 * its copy inside the cards, so its body is usually empty — the first card's
 * title is what an operator recognises it by.
 */
export function savedMessagePreview(message: SavedMessage): string {
  if (!usesCards(message.layout)) return message.body
  return message.cards.map((card) => card.title).filter(Boolean).join(' · ') || message.body
}

/**
 * The body the server will store for this send. Mirrors the rule in
 * src/lib/saved-messages/resolve.ts so the optimistic bubble matches the real
 * row exactly and retires the moment that row arrives.
 */
export function savedMessageSendBody(message: SavedMessage, overrideText?: string): string {
  if (!usesCards(message.layout)) {
    return (overrideText?.trim() || message.body).trim().slice(0, textMaxFor(message.layout))
  }
  const first = message.cards[0]?.title.trim()
  if (!first) return 'Card message'
  return message.cards.length > 1 ? `${first} (+${message.cards.length - 1} more)` : first
}

export function useSavedMessages() {
  return useQuery({
    queryKey: savedKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_messages')
        .select(SELECT)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return ((data ?? []) as SavedMessage[]).map(normalizeRow)
    },
  })
}

/** One saved message by id — the editor opens straight from a deep link. */
export function useSavedMessage(id: string | null | undefined) {
  return useQuery({
    queryKey: savedKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_messages')
        .select(SELECT)
        .eq('id', id!)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? normalizeRow(data as SavedMessage) : null
    },
  })
}

/**
 * Row shape shared by insert and update, after trimming and clamping. Throws
 * the same message the editor shows inline, so a save can never write a row the
 * send path would then have to guess about.
 */
function toRow(input: SavedMessageInput) {
  const title = input.title.trim()
  if (!title) throw new Error('Give this saved message a title.')

  const { layout } = input
  const onCards = usesCards(layout)
  const body = input.body.trim().slice(0, textMaxFor(layout))
  const buttons = layout === 'buttons' ? input.buttons : []
  const cards = onCards ? input.cards.slice(0, maxCardsFor(layout)) : []

  const problem = validateSavedMessage({ layout, body, buttons, cards })
  if (problem) throw new Error(problem)

  return {
    title: title.slice(0, TITLE_MAX),
    body,
    shortcut: normalizeShortcut(input.shortcut),
    layout,
    buttons,
    cards,
  }
}

export function useUpsertSavedMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SavedMessageInput) => {
      const row = toRow(input)
      if (input.id) {
        const { error } = await supabase.from('saved_messages').update(row).eq('id', input.id)
        if (error) throw new Error(describeSaveError(error.message))
        return input.id
      }
      const { data: me } = await supabase.auth.getUser()
      const { count } = await supabase
        .from('saved_messages')
        .select('id', { count: 'exact', head: true })
      const { data, error } = await supabase
        .from('saved_messages')
        .insert({ ...row, user_id: me.user?.id, position: count ?? 0 })
        .select('id')
        .single()
      if (error) throw new Error(describeSaveError(error.message))
      return data.id as string
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: savedKeys.all })
      if (id) qc.invalidateQueries({ queryKey: savedKeys.one(id) })
    },
  })
}

export function useDeleteSavedMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('saved_messages').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: savedKeys.all }),
  })
}

/** Postgres constraint text is not something to show an operator. */
function describeSaveError(message: string): string {
  if (message.includes('saved_messages_user_id_shortcut_key')) {
    return 'That shortcut is already used by another saved message.'
  }
  if (message.includes('saved_messages_shortcut_check')) {
    return 'A shortcut can only use letters, numbers, dashes and underscores.'
  }
  if (message.includes('saved_messages_buttons_check')) {
    return 'A message can carry at most 3 buttons.'
  }
  if (message.includes('saved_messages_cards_check')) {
    return `A carousel holds between 1 and ${CARDS_MAX} cards.`
  }
  return message
}
