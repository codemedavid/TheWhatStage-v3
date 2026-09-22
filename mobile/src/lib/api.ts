import { env } from './env'
import { supabase } from './supabase'

// Thin client for the Next.js /api/mobile/* routes. Anything that needs the
// decrypted Page token (Messenger sends) or the service role (audited stage
// moves) lives behind these; everything else reads Supabase directly.

export type ApiResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return token
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const token = await bearer()
  let res: Response
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })
  } catch {
    return { ok: false, error: 'network_unreachable' }
  }
  const json = (await res.json().catch(() => null)) as ApiResult<T> | null
  if (!json) return { ok: false, error: `http_${res.status}` }
  return json
}

export const api = {
  sendMessage(leadId: string, text: string, opts: { personalize?: boolean } = {}) {
    return request('/api/mobile/messages/send', {
      method: 'POST',
      body: JSON.stringify({ leadId, text, personalize: opts.personalize ?? false }),
    })
  },
  listActionPages() {
    return request<{ pages: SendableActionPage[] }>('/api/mobile/action-pages')
  },
  sendActionPage(
    leadId: string,
    actionPageId: string,
    overrides: { messageText?: string; ctaLabel?: string; personalize?: boolean } = {},
  ) {
    return request('/api/mobile/action-pages/send', {
      method: 'POST',
      body: JSON.stringify({ leadId, actionPageId, ...overrides }),
    })
  },
  /**
   * Send a stored saved message with whatever layout it carries — text,
   * buttons, card or carousel. `text` is the operator's composer edit and
   * applies to the text layouts only.
   */
  sendSavedMessage(leadId: string, savedMessageId: string, text?: string) {
    return request('/api/mobile/saved-messages/send', {
      method: 'POST',
      body: JSON.stringify({ leadId, savedMessageId, ...(text ? { text } : {}) }),
    })
  },
  sendMedia(leadId: string, assetId: string) {
    return request('/api/mobile/media/send', {
      method: 'POST',
      body: JSON.stringify({ leadId, assetId }),
    })
  },
  /** Step 1 of an upload: register the files and get signed upload URLs. */
  mediaUploadIntent(files: UploadFileMeta[]) {
    return request<{ uploads: UploadIntentEntry[] }>('/api/mobile/media/upload-intent', {
      method: 'POST',
      body: JSON.stringify({ files }),
    })
  },
  /** Step 3: publish the rows whose bytes have landed in storage. */
  mediaUploadComplete(assetIds: string[]) {
    return request<{ assets: UploadedMediaAsset[]; failed: string[] }>(
      '/api/mobile/media/upload-complete',
      { method: 'POST', body: JSON.stringify({ assetIds }) },
    )
  },
  moveLead(leadId: string, toStageId: string) {
    return request('/api/mobile/leads/move', {
      method: 'POST',
      body: JSON.stringify({ leadId, toStageId }),
    })
  },
  moveProject(projectId: string, toStageId: string) {
    return request<{ stageChanged: boolean }>('/api/mobile/projects/move', {
      method: 'POST',
      body: JSON.stringify({ projectId, toStageId }),
    })
  },
  registerPushToken(device: { token: string; platform: 'ios' | 'android'; deviceName?: string | null }) {
    return request<{ enabled: boolean }>('/api/mobile/push/register', {
      method: 'POST',
      body: JSON.stringify(device),
    })
  },
  unregisterPushToken(token: string) {
    return request('/api/mobile/push/unregister', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  },
  togglePushToken(token: string, enabled: boolean) {
    return request('/api/mobile/push/toggle', {
      method: 'POST',
      body: JSON.stringify({ token, enabled }),
    })
  },
}

/** What the intent route needs to know about a file before it exists in storage. */
export interface UploadFileMeta {
  name: string
  type: string
  size: number
}

/** One signed grant to PUT a file straight into Supabase Storage. */
export interface UploadIntentEntry {
  assetId: string
  path: string
  token: string
  signedUrl: string
  contentType: string
}

export interface UploadedMediaAsset {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
}

export interface SendableActionPage {
  id: string
  title: string
  kind: string
  description: string | null
  cta_label: string | null
}
