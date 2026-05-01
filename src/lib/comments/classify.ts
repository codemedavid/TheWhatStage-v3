import { HfRouterLlm } from '@/lib/rag'

const categories = ['good', 'question', 'spam', 'abusive', 'needs_no_action'] as const
const confidences = ['low', 'medium', 'high'] as const
const actions = ['none', 'public_reply', 'private_reply', 'hide', 'delete'] as const

export type CommentCategory = (typeof categories)[number]
export type CommentConfidence = (typeof confidences)[number]
export type CommentModerationAction = (typeof actions)[number]

export interface CommentDecision {
  category: CommentCategory
  confidence: CommentConfidence
  publicReply: string | null
  privateReply: string | null
  moderationAction: CommentModerationAction
  reason: string
}

export interface CommentClassifierInput {
  message: string
  pageName: string
  complete?: (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseCommentDecision(raw: string): CommentDecision | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (!isOneOf(obj.category, categories)) return null
  if (!isOneOf(obj.confidence, confidences)) return null
  if (!isOneOf(obj.moderation_action, actions)) return null

  let moderationAction = obj.moderation_action
  if (obj.confidence !== 'high' && (moderationAction === 'hide' || moderationAction === 'delete')) {
    moderationAction = 'none'
  }

  return {
    category: obj.category,
    confidence: obj.confidence,
    publicReply: nullableString(obj.public_reply),
    privateReply: nullableString(obj.private_reply),
    moderationAction,
    reason: nullableString(obj.reason) ?? 'No reason provided',
  }
}

export async function classifyComment(input: CommentClassifierInput): Promise<CommentDecision | null> {
  const system =
    'You classify Facebook Page comments for a business CRM. Output JSON only. ' +
    'Schema: {"category":"good|question|spam|abusive|needs_no_action","confidence":"low|medium|high","public_reply":string|null,"private_reply":string|null,"moderation_action":"none|public_reply|private_reply|hide|delete","reason":string}. ' +
    'Spam means scams, repeated promotion, malicious links, fake giveaways, or irrelevant commercial spam. ' +
    'Abusive means clear harassment, threats, profane attacks, hate, or unsafe content. ' +
    'Mild negative feedback is not abuse. Destructive actions hide/delete require high confidence. ' +
    'Use private_reply for customer questions when a private response would be useful.'

  const user = `Page: ${input.pageName}\nComment:\n${input.message}`
  const complete =
    input.complete ??
    (async (messages: { role: 'system' | 'user'; content: string }[]) => {
      const llm = new HfRouterLlm()
      return llm.complete(messages, { temperature: 0, maxTokens: 350, responseFormat: 'json_object' })
    })

  return parseCommentDecision(await complete([{ role: 'system', content: system }, { role: 'user', content: user }]))
}
