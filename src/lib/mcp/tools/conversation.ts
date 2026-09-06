import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MEDIA_ASSETS_BUCKET, normalizeAttachmentType } from '@/lib/messenger/attachments'
import { attachmentToContent, fetchAttachment } from '../attachment-fetch'
import { defineTool } from '../define-tool'
import { jsonResult, McpToolError, type McpContext } from '../context'

const CONVERSATION_LIMIT_MAX = 200
const SIGNED_URL_TTL_SECONDS = 60 * 5

type StoredAttachment = {
  type?: string
  url?: string
  storage_path?: string
  name?: string
  payload?: { url?: string }
}

function storedAttachments(raw: unknown): StoredAttachment[] {
  return Array.isArray(raw) ? (raw as StoredAttachment[]) : []
}

function attachmentSource(a: StoredAttachment): 'storage' | 'meta_cdn' | 'external' | 'none' {
  if (a.storage_path) return 'storage'
  if (a.payload?.url) return 'meta_cdn'
  if (a.url) return 'external'
  return 'none'
}

// Pure: describe attachments without fetching them, so the model can decide
// which ones to open with get_message_attachment.
export function summarizeAttachments(raw: unknown): Array<{
  index: number
  type: string
  name: string | null
  source: 'storage' | 'meta_cdn' | 'external' | 'none'
  note: string
}> {
  return storedAttachments(raw).map((a, index) => {
    const source = attachmentSource(a)
    const note =
      source === 'meta_cdn'
        ? 'Customer-sent via Messenger; Meta CDN links expire after a while, so older ones may be unavailable.'
        : source === 'none'
          ? 'No URL stored.'
          : 'Retrievable with get_message_attachment.'
    return { index, type: normalizeAttachmentType(a.type), name: a.name ?? null, source, note }
  })
}

async function loadThreadForLead(ctx: McpContext, leadId: string) {
  const { data, error } = await ctx.admin
    .from('messenger_threads')
    .select('id, full_name, last_inbound_at, last_outbound_at, auto_reply_enabled, bot_paused_until, conversation_summary, facebook_pages(name)')
    .eq('user_id', ctx.userId).eq('lead_id', leadId)
    .maybeSingle()
  if (error) throw error
  return data
}

export function registerConversationTools(server: McpServer, ctx: McpContext): void {
  defineTool(server, ctx, {
    name: 'get_conversation',
    title: 'Get Messenger conversation',
    description:
      'The Messenger chat history between the business and a lead, oldest first. Each message has direction (inbound = customer, outbound = us), sender (user = customer, bot = AI, operator = human), text body, and a list of attachments (images, files, voice notes) the customer or operator sent. To actually see an image or read a file, call get_message_attachment with the message id and attachment index. Does not mark the thread as read. Read-only.',
    input: {
      lead_id: z.string().uuid(),
      limit: z.number().int().min(1).max(CONVERSATION_LIMIT_MAX).default(100).describe('Most recent N messages.'),
      before: z.string().datetime().optional().describe('ISO timestamp; page further back by passing the created_at of the oldest message you already have.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ lead_id, limit, before }) => {
    const thread = await loadThreadForLead(ctx, lead_id)
    if (!thread) throw new McpToolError('This lead has no Messenger conversation.')

    let q = ctx.admin
      .from('messenger_messages')
      .select('id, direction, sender, body, created_at, error, attachments')
      .eq('user_id', ctx.userId).eq('thread_id', thread.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (before) q = q.lt('created_at', before)
    const { data, error } = await q
    if (error) throw error

    const messages = (data ?? []).reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      sender: m.sender,
      body: m.body,
      created_at: m.created_at,
      error: m.error,
      attachments: summarizeAttachments(m.attachments),
    }))
    const page = Array.isArray(thread.facebook_pages) ? thread.facebook_pages[0] : thread.facebook_pages
    return jsonResult({
      thread: {
        id: thread.id,
        customer_name: thread.full_name,
        page_name: (page as { name?: string } | null)?.name ?? null,
        last_inbound_at: thread.last_inbound_at,
        last_outbound_at: thread.last_outbound_at,
        auto_reply_enabled: thread.auto_reply_enabled,
        bot_paused_until: thread.bot_paused_until,
        ai_summary: thread.conversation_summary,
      },
      messages,
      has_more: (data ?? []).length === limit,
    })
  })

  defineTool(server, ctx, {
    name: 'get_message_attachment',
    title: 'Get message attachment',
    description:
      'Fetch one attachment from a Messenger message so you can look at it. Images are returned as image content (you can see them); text/PDF/other files are returned as an embedded resource. Limits: 10 MB, 15 s. Customer-sent images live on Meta\'s CDN and expire; if one is gone the tool says so instead of guessing. Read-only.',
    input: {
      message_id: z.string().uuid(),
      index: z.number().int().min(0).default(0).describe('Position in the message\'s attachments list (from get_conversation).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ message_id, index }) => {
    const { data: msg, error } = await ctx.admin
      .from('messenger_messages')
      .select('id, attachments')
      .eq('user_id', ctx.userId).eq('id', message_id)
      .maybeSingle()
    if (error) throw error
    if (!msg) throw new McpToolError('Message not found.')
    const list = storedAttachments(msg.attachments)
    const a = list[index]
    if (!a) throw new McpToolError(`Message has ${list.length} attachment(s); index ${index} does not exist.`)

    let url: string | null = null
    if (a.storage_path) {
      const { data: signed } = await ctx.admin.storage
        .from(MEDIA_ASSETS_BUCKET)
        .createSignedUrl(a.storage_path, SIGNED_URL_TTL_SECONDS)
      url = signed?.signedUrl ?? null
    } else {
      url = a.url ?? a.payload?.url ?? null
    }
    const meta = { messageId: message_id, index, type: normalizeAttachmentType(a.type), name: a.name ?? null }
    if (!url) {
      return attachmentToContent({ kind: 'unavailable', reason: 'No URL is stored for this attachment.', likelyExpired: false }, meta)
    }
    return attachmentToContent(await fetchAttachment(url), meta)
  })
}
