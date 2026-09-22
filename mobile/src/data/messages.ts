import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MessageRow } from './types'

const MESSAGE_SELECT =
  'id, thread_id, direction, sender, body, attachments, error, fb_message_id, created_at'
const MESSAGE_PAGE = 200

export const messageKeys = {
  thread: (threadId: string) => ['messages', threadId] as const,
}

export async function fetchMessages(threadId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messenger_messages')
    .select(MESSAGE_SELECT)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE)
  if (error) throw new Error(error.message)
  // Stored newest-first for an inverted FlatList.
  return (data ?? []) as MessageRow[]
}

export function useMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.thread(threadId ?? ''),
    enabled: !!threadId,
    queryFn: () => fetchMessages(threadId!),
  })
}

/** Append inserts for this thread straight into the cache (no refetch). */
export function useMessagesRealtime(threadId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!threadId) return
    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messenger_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as MessageRow
          qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) => {
            if (!prev) return [row]
            if (prev.some((m) => m.id === row.id)) return prev
            return [row, ...prev]
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messenger_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as MessageRow
          qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) =>
            prev ? prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)) : prev,
          )
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc, threadId])
}

/** Resolve a display URL for an attachment; signs storage paths on demand. */
export async function attachmentUrl(att: {
  url?: string
  payload?: { url?: string }
  storage_path?: string
}): Promise<string | null> {
  if (att.url) return att.url
  if (att.payload?.url) return att.payload.url
  if (att.storage_path) {
    const { data } = await supabase.storage
      .from('media-assets')
      .createSignedUrl(att.storage_path, 60 * 60)
    return data?.signedUrl ?? null
  }
  return null
}
