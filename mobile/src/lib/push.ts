import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { api } from './api'

// Device-side half of push. Everything that talks to the OS or to Expo's token
// service lives here; the React wiring (when to register, what a tap does) is
// in providers/push.tsx.

/** Android channel id. Must match PUSH_CHANNEL_ID in src/lib/push/notify.ts. */
export const PUSH_CHANNEL_ID = 'messages'

export type PushStatus =
  /** Registered with the server; notifications will arrive. */
  | 'registered'
  /** The operator declined the OS permission prompt. */
  | 'denied'
  /** Simulator or Expo Go — remote push needs a real device running a dev build. */
  | 'unsupported'
  /** No EAS project id in app.json, so Expo cannot mint a token. */
  | 'unconfigured'
  /** Network or Expo-service failure; worth retrying on the next launch. */
  | 'error'

// The token for this install, cached so sign-out can release the exact row it
// registered without asking the OS again (which fails once permissions are
// being torn down).
let currentToken: string | null = null

export function getPushToken(): string | null {
  return currentToken
}

/** Expo Go cannot receive remote push as of SDK 53 — a dev build is required. */
function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId
  return fromConfig ?? Constants.easConfig?.projectId ?? null
}

/**
 * Android delivers nothing unless the channel exists first. Created on every
 * launch (the call is an upsert) so an app update can change its settings.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: 'Messages',
    description: 'New messages from your Facebook Page conversations',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#059669',
  })
}

async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync()
  if (existing.granted) return true
  // Already permanently denied — asking again is a no-op prompt the user never
  // sees, so send them to Settings instead (the Me screen explains this).
  if (!existing.canAskAgain) return false
  const next = await Notifications.requestPermissionsAsync()
  return next.granted
}

/**
 * Ask the OS for permission and Expo for a token. Returns the status alone when
 * no token could be obtained — every branch here is an expected outcome, not an
 * error to throw at the UI.
 */
export async function acquirePushToken(): Promise<{ status: PushStatus; token?: string }> {
  if (!Device.isDevice || isExpoGo()) return { status: 'unsupported' }

  const projectId = easProjectId()
  if (!projectId) {
    console.warn('[push] no EAS projectId in app.json — run `eas init` (see mobile/README.md)')
    return { status: 'unconfigured' }
  }

  try {
    await ensureAndroidChannel()
    if (!(await ensurePermission())) return { status: 'denied' }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    return { status: 'registered', token }
  } catch (err) {
    console.warn('[push] token request failed', err)
    return { status: 'error' }
  }
}

export interface PushRegistration {
  status: PushStatus
  /** The server's stored mute for this device; true whenever unknown. */
  enabled: boolean
}

/** Acquire a token and hand it to the server. Safe to call on every launch. */
export async function registerPushDevice(): Promise<PushRegistration> {
  const { status, token } = await acquirePushToken()
  if (status !== 'registered' || !token) return { status, enabled: true }

  const platform = Platform.OS === 'android' ? 'android' : 'ios'
  const res = await api.registerPushToken({ token, platform, deviceName: Device.deviceName })
  if (!res.ok) {
    console.warn('[push] register failed', res.error)
    return { status: 'error', enabled: true }
  }
  currentToken = token
  return { status: 'registered', enabled: res.enabled }
}

/**
 * Drop this device server-side. Called before sign-out, while the session is
 * still valid — afterwards the bearer token is gone and the row would linger,
 * delivering the next operator's messages to the wrong phone.
 */
export async function releasePushDevice(): Promise<void> {
  const token = currentToken
  currentToken = null
  await Notifications.setBadgeCountAsync(0).catch(() => {})
  if (!token) return
  const res = await api.unregisterPushToken(token)
  if (!res.ok) console.warn('[push] unregister failed', res.error)
}

/** Per-device mute. Returns false when the change could not be saved. */
export async function setPushEnabled(enabled: boolean): Promise<boolean> {
  const token = currentToken
  if (!token) return false
  const res = await api.togglePushToken(token, enabled)
  if (!res.ok) {
    console.warn('[push] toggle failed', res.error)
    return false
  }
  return true
}
