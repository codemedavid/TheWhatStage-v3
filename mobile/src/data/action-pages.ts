import { useQuery } from '@tanstack/react-query'
import { api, type SendableActionPage } from '@/lib/api'

// Published pages come from the API rather than a direct Supabase read so the
// "published only" rule lives in one place (listSendableActionPagesFor) and a
// draft page can never be attached to a send or a saved message.

export const actionPageKeys = { sendable: ['action-pages', 'sendable'] as const }

export function useSendableActionPages(enabled = true) {
  return useQuery({
    queryKey: actionPageKeys.sendable,
    enabled,
    // Pages change far less often than chats; a minute of cache spares the
    // round trip when the picker is opened repeatedly while composing.
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.listActionPages()
      if (!res.ok) throw new Error(res.error)
      return res.pages
    },
  })
}

export type { SendableActionPage }
