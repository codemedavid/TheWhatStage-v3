import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  listSendableActionPagesFor,
  replyAsOperatorFor,
  sendActionPageFor,
  type SendResult,
} from '@/lib/messenger/operator-send'
import { defineTool } from '../define-tool'
import { jsonResult, type McpContext } from '../context'

// Messenger caps a single text message at 2000 chars; the send layer splits
// longer text, but keep the tool contract explicit.
const MESSAGE_MAX = 2000
const ACTION_PAGE_TEXT_MAX = 640
const ACTION_PAGE_CTA_MAX = 20

function explainSend(result: SendResult): Record<string, unknown> {
  if (result.ok) return { ok: true }
  const blocked = result.error.startsWith('policy_blocked:')
  return {
    ok: false,
    error: result.error,
    explanation: blocked
      ? 'Meta\'s messaging policy blocked this send. Operator replies are allowed within 7 days of the customer\'s last message (human-agent window); outside that, only an approved utility template can be sent from the dashboard.'
      : 'The send failed and was recorded on the thread with this error.',
  }
}

export function registerMessagingTools(server: McpServer, ctx: McpContext): void {
  defineTool(server, ctx, {
    name: 'send_message',
    title: 'Send Messenger message',
    description:
      `Send a plain-text Messenger message to a lead as the human operator. Side effects: the message is recorded on the thread, and the AI chatbot is paused on this thread for the business's configured human-takeover window so it does not talk over you. Allowed within 7 days of the customer's last message. Max ${MESSAGE_MAX} characters. Returns ok:false with a policy_blocked:* error when Meta's rules prevent the send.`,
    scope: 'send',
    input: {
      lead_id: z.string().uuid(),
      text: z.string().trim().min(1).max(MESSAGE_MAX),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ lead_id, text }) => {
    const result = await replyAsOperatorFor(ctx.admin, ctx.userId, lead_id, text)
    return jsonResult(explainSend(result))
  })

  defineTool(server, ctx, {
    name: 'list_action_pages',
    title: 'List sendable action pages',
    description:
      'Published action pages (forms, booking pages, quizzes, order/catalog pages) that can be sent into a conversation as a button. Use the id with send_action_page. Read-only.',
    input: {},
    annotations: { readOnlyHint: true },
  }, async () => jsonResult({ action_pages: await listSendableActionPagesFor(ctx.admin, ctx.userId) }))

  defineTool(server, ctx, {
    name: 'send_action_page',
    title: 'Send action page',
    description:
      `Send a published action page to a lead as a Messenger button with a personalised, signed link (valid 30 days). Optional message_text (max ${ACTION_PAGE_TEXT_MAX} chars) and cta_label (max ${ACTION_PAGE_CTA_MAX} chars) override the page's saved defaults for this send only. Same side effects and policy rules as send_message.`,
    scope: 'send',
    input: {
      lead_id: z.string().uuid(),
      action_page_id: z.string().uuid(),
      message_text: z.string().trim().min(1).max(ACTION_PAGE_TEXT_MAX).optional(),
      cta_label: z.string().trim().min(1).max(ACTION_PAGE_CTA_MAX).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ lead_id, action_page_id, message_text, cta_label }) => {
    const result = await sendActionPageFor(ctx.admin, ctx.userId, lead_id, action_page_id, {
      messageText: message_text,
      ctaLabel: cta_label,
    })
    return jsonResult(explainSend(result))
  })
}
