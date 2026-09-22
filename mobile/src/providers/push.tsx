import * as Notifications from 'expo-notifications'
import { useRouter, usePathname, useRootNavigationState } from 'expo-router'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useUnreadThreadCount } from '@/data/threads'
import { registerPushDevice, setPushEnabled, type PushStatus } from '@/lib/push'
import { useAuth } from '@/providers/auth'

// React side of push: when to register, what a notification does while the app
// is open, and where a tap lands. The OS/Expo plumbing is in lib/push.ts.

/** Payload our server attaches to every inbound-message push. */
interface InboundPushData {
  type?: string
  threadId?: string
  leadId?: string | null
}

// The chat screen the operator is currently looking at. Realtime already drops
// the new message into that thread, so banner-ing it on top is pure noise —
// the handler below suppresses it. A module-level ref (not state) because the
// notification handler is registered once, outside React.
const focusedThreadRef = { current: null as string | null }

function threadIdOf(notification: Notifications.Notification): string | undefined {
  const data = notification.request.content.data as InboundPushData | undefined
  return typeof data?.threadId === 'string' ? data.threadId : undefined
}

Notifications.setNotificationHandler({
  async handleNotification(notification) {
    const isFocusedThread =
      !!focusedThreadRef.current && threadIdOf(notification) === focusedThreadRef.current
    return {
      shouldShowBanner: !isFocusedThread,
      shouldShowList: true,
      shouldPlaySound: !isFocusedThread,
      // The server sends an absolute badge count; letting the OS increment on
      // top of it would double-count.
      shouldSetBadge: false,
    }
  },
})

interface PushState {
  status: PushStatus | 'pending'
  /** False when this device is muted from the Me screen. */
  enabled: boolean
  setEnabled: (next: boolean) => Promise<void>
  isSaving: boolean
}

const PushContext = createContext<PushState | null>(null)

/**
 * Mirrors the in-app unread count onto the app icon. Reading a thread clears
 * its unread_count, realtime refreshes the query, and the badge follows —
 * without this the badge would only ever count up.
 *
 * A child rather than a hook in the provider: it must not query threads while
 * nobody is signed in.
 */
function BadgeSync() {
  const unreadCount = useUnreadThreadCount().data ?? 0
  useEffect(() => {
    Notifications.setBadgeCountAsync(unreadCount).catch(() => {})
  }, [unreadCount])
  return null
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { userId, isReady } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const navigationState = useRootNavigationState()

  const [status, setStatus] = useState<PushStatus | 'pending'>('pending')
  const [enabled, setEnabledState] = useState(true)
  const [isSaving, setSaving] = useState(false)

  // Register once per signed-in user. Re-running on every render would spam
  // Expo's token service; re-running on user change is required so the row
  // follows whoever is signed in.
  const registeredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!userId || !isReady) {
      registeredFor.current = null
      return
    }
    if (registeredFor.current === userId) return
    registeredFor.current = userId
    let cancelled = false
    registerPushDevice().then((result) => {
      if (cancelled) return
      setStatus(result.status)
      setEnabledState(result.enabled)
    })
    return () => {
      cancelled = true
    }
  }, [userId, isReady])

  // Keep the module ref in step with navigation so the handler can mute the
  // banner for the thread already on screen.
  useEffect(() => {
    const match = /^\/chat\/([^/]+)$/.exec(pathname ?? '')
    focusedThreadRef.current = match ? match[1] : null
  }, [pathname])

  // A tap opens the conversation. Taps arrive both while the app is running and
  // as the event that launched it; `useLastNotificationResponse` covers the
  // cold start a listener would miss, and the ref guards against re-navigating
  // to the same one on every re-render.
  const lastResponse = Notifications.useLastNotificationResponse()
  const handledResponse = useRef<string | null>(null)
  const isNavigatorReady = !!navigationState?.key
  useEffect(() => {
    // A cold-start tap resolves before the navigator exists; pushing then is
    // dropped on the floor, so wait for it.
    if (!lastResponse || !isReady || !isNavigatorReady) return
    const { identifier } = lastResponse.notification.request
    if (handledResponse.current === identifier) return
    const threadId = threadIdOf(lastResponse.notification)
    if (!threadId) return
    handledResponse.current = identifier
    // navigate, not push: tapping a notification for the chat already on screen
    // should surface it, not stack a second copy of it.
    router.navigate(`/chat/${threadId}`)
  }, [lastResponse, isReady, isNavigatorReady, router])

  const setEnabled = useCallback(async (next: boolean) => {
    setSaving(true)
    // Optimistic: the switch should not lag a network round trip.
    setEnabledState(next)
    const saved = await setPushEnabled(next)
    if (!saved) setEnabledState(!next)
    setSaving(false)
  }, [])

  const value = useMemo<PushState>(
    () => ({ status, enabled, setEnabled, isSaving }),
    [status, enabled, setEnabled, isSaving],
  )

  return (
    <PushContext.Provider value={value}>
      {isReady ? <BadgeSync /> : null}
      {children}
    </PushContext.Provider>
  )
}

export function usePush(): PushState {
  const ctx = useContext(PushContext)
  if (!ctx) throw new Error('usePush must be used inside PushProvider')
  return ctx
}
