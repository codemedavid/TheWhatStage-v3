import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import {
  deleteComment,
  fetchComment,
  hideComment,
  replyToComment,
  sendPrivateCommentReply,
  type FacebookComment,
} from '@/lib/facebook/comments'
import { classifyComment, type CommentDecision } from '@/lib/comments/classify'
import { answer } from '@/lib/chatbot/answer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
const BATCH_SIZE = 5
const RUNNING_STALE_SECONDS = 300
const BRIDGE_TTL_MS = 30 * 24 * 60 * 60 * 1000

type AdminClient = ReturnType<typeof createAdminClient>
type GraphAction = 'none' | 'public_reply' | 'private_reply' | 'hide' | 'delete'
type GraphStatus = 'sent' | 'hidden' | 'deleted' | 'failed' | 'skipped'

interface CommentJob {
  id: string
  page_id: string
  user_id: string
  fb_comment_id: string
  fb_parent_id: string | null
  fb_post_id: string | null
  webhook_event: unknown
  attempts: number
}

type CapabilitySlice = Pick<FacebookComment, 'canRemove' | 'canHide' | 'canReplyPrivately'>

export function chooseGraphAction(args: {
  decision: CommentDecision
  comment: CapabilitySlice
}): GraphAction {
  const { decision, comment } = args
  const requested = decision.moderationAction
  const destructive = requested === 'delete' || requested === 'hide'

  if (destructive && decision.confidence !== 'high') {
    return 'none'
  }

  if (requested === 'delete') {
    if (comment.canRemove) return 'delete'
    if (comment.canHide) return 'hide'
    return 'none'
  }

  if (requested === 'hide') {
    return comment.canHide ? 'hide' : 'none'
  }

  if (requested === 'private_reply') {
    if (comment.canReplyPrivately && decision.privateReply) return 'private_reply'
    if (decision.publicReply) return 'public_reply'
    return 'none'
  }

  if (requested === 'public_reply') {
    return decision.publicReply ? 'public_reply' : 'none'
  }

  return 'none'
}

export function shouldPersistComment(args: {
  leadId: string | null
  attemptedPrivateReply: boolean
  failedAction: boolean
}): boolean {
  return Boolean(args.leadId || args.attemptedPrivateReply || args.failedAction)
}

export async function POST(req: NextRequest) {
  const secret = process.env.COMMENT_WORKER_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'worker not configured' }, { status: 500 })
  }

  const got = req.headers.get('x-worker-secret') ?? ''
  const expected = Buffer.from(secret)
  const received = Buffer.from(got)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const jobs = await claimJobs(admin)
  await Promise.allSettled(
    jobs.map((job) =>
      runJob(admin, job).catch((e) => {
        console.error('[comments.worker] runJob threw', job.id, e)
      }),
    ),
  )

  return NextResponse.json({ processed: jobs.length })
}

async function claimJobs(admin: AdminClient): Promise<CommentJob[]> {
  const { data, error } = await admin.rpc('claim_facebook_comment_jobs', {
    p_limit: BATCH_SIZE,
    p_stale_seconds: RUNNING_STALE_SECONDS,
  })
  if (error) {
    console.error('[comments.worker] claim rpc failed', error)
    return []
  }
  return (data ?? []) as CommentJob[]
}

async function runJob(admin: AdminClient, job: CommentJob): Promise<void> {
  try {
    const { data: page, error: pageErr } = await admin
      .from('facebook_pages')
      .select('id, name, page_access_token')
      .eq('id', job.page_id)
      .single<{ id: string; name: string; page_access_token: string }>()
    if (pageErr || !page) {
      throw new Error(`page ${job.page_id} missing`)
    }

    const pageToken = decryptToken(page.page_access_token)
    const comment = await fetchComment({
      pageAccessToken: pageToken,
      commentId: job.fb_comment_id,
    })
    if (!comment.message.trim()) {
      await markDone(admin, job.id, 'skipped', 'empty comment')
      return
    }

    const leadId = await findStrictLeadMatch(admin, {
      pageId: job.page_id,
      commenterId: comment.commenterId,
    })
    const decision = await classifyComment({ message: comment.message, pageName: page.name })
    if (!decision) {
      await markDone(admin, job.id, 'skipped', 'classification failed')
      return
    }

    const action = chooseGraphAction({ decision, comment })

    // For reply actions, regenerate the reply text using the RAG pipeline so it
    // uses the bot's personality and knowledge base instead of the classifier stub.
    if (action === 'private_reply' || action === 'public_reply') {
      const ragResult = await answer(admin, job.user_id, comment.message, [], {
        rpcName: 'match_knowledge_hybrid_service',
      }).catch(() => null)
      const ragText = ragResult?.text?.trim()
      if (ragText) {
        decision.privateReply = ragText
        decision.publicReply = ragText
      }
    }
    let graphStatus: GraphStatus = 'skipped'
    let graphError: string | null = null
    let attemptedPrivateReply = false
    let privateReplyMessageId: string | null = null

    try {
      if (action === 'delete') {
        await deleteComment({ pageAccessToken: pageToken, commentId: comment.id })
        graphStatus = 'deleted'
      } else if (action === 'hide') {
        await hideComment({ pageAccessToken: pageToken, commentId: comment.id })
        graphStatus = 'hidden'
      } else if (action === 'private_reply' && decision.privateReply) {
        attemptedPrivateReply = true
        try {
          const sent = await sendPrivateCommentReply({
            pageAccessToken: pageToken,
            commentId: comment.id,
            message: decision.privateReply,
          })
          privateReplyMessageId = sent.id
          graphStatus = 'sent'
          // Record the DM in the Messenger thread if one exists for this commenter
          await recordDmInThread(admin, {
            pageId: job.page_id,
            psid: comment.commenterId,
            messageId: sent.id,
            body: decision.privateReply,
          })
        } catch {
          if (decision.publicReply) {
            await replyToComment({
              pageAccessToken: pageToken,
              commentId: comment.id,
              message: decision.publicReply,
            })
            graphStatus = 'sent'
          } else {
            graphStatus = 'skipped'
          }
        }
      } else if (action === 'public_reply' && decision.publicReply) {
        await replyToComment({
          pageAccessToken: pageToken,
          commentId: comment.id,
          message: decision.publicReply,
        })
        graphStatus = 'sent'
      }
    } catch (e) {
      graphStatus = 'failed'
      graphError = e instanceof Error ? e.message : String(e)
    }

    if (shouldPersistComment({ leadId, attemptedPrivateReply, failedAction: graphStatus === 'failed' })) {
      if (leadId) {
        await persistLeadComment(admin, {
          job,
          leadId,
          comment,
          decision,
          action,
          graphStatus,
          graphError,
        })
      } else if (attemptedPrivateReply) {
        await persistBridge(admin, {
          job,
          comment,
          privateReplyMessageId,
        })
      }
    }

    if (graphStatus === 'failed') {
      throw new Error(graphError ?? 'graph action failed')
    }

    await markDone(admin, job.id, action === 'none' ? 'skipped' : 'done', null)
  } catch (e) {
    await retryOrFail(admin, job, e)
  }
}

async function recordDmInThread(
  admin: AdminClient,
  args: { pageId: string; psid: string | null; messageId: string; body: string },
): Promise<void> {
  if (!args.psid) return
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, user_id')
    .eq('page_id', args.pageId)
    .eq('psid', args.psid)
    .maybeSingle<{ id: string; user_id: string }>()
  if (!thread) return
  await admin.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: thread.user_id,
    direction: 'outbound',
    sender: 'bot',
    fb_message_id: args.messageId,
    body: args.body,
  })
  await admin
    .from('messenger_threads')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: args.body.slice(0, 200) })
    .eq('id', thread.id)
}

async function findStrictLeadMatch(
  admin: AdminClient,
  args: { pageId: string; commenterId: string | null },
): Promise<string | null> {
  if (!args.commenterId) return null

  const { data } = await admin
    .from('messenger_threads')
    .select('lead_id')
    .eq('page_id', args.pageId)
    .eq('psid', args.commenterId)
    .not('lead_id', 'is', null)
    .maybeSingle<{ lead_id: string | null }>()

  return data?.lead_id ?? null
}

async function persistLeadComment(
  admin: AdminClient,
  args: {
    job: CommentJob
    leadId: string
    comment: FacebookComment
    decision: CommentDecision
    action: GraphAction
    graphStatus: GraphStatus
    graphError: string | null
  },
): Promise<void> {
  await admin.from('facebook_lead_comments').upsert(
    {
      lead_id: args.leadId,
      page_id: args.job.page_id,
      user_id: args.job.user_id,
      fb_comment_id: args.comment.id,
      fb_post_id: args.job.fb_post_id,
      fb_parent_id: args.job.fb_parent_id ?? args.comment.parentId,
      commenter_id: args.comment.commenterId,
      commenter_name: args.comment.commenterName,
      message: args.comment.message,
      classification: args.decision.category,
      confidence: args.decision.confidence,
      moderation_action: args.action,
      public_reply: args.decision.publicReply,
      private_reply: args.decision.privateReply,
      graph_status: args.graphStatus,
      graph_error: args.graphError,
    },
    { onConflict: 'fb_comment_id' },
  )
}

async function persistBridge(
  admin: AdminClient,
  args: {
    job: CommentJob
    comment: FacebookComment
    privateReplyMessageId: string | null
  },
): Promise<void> {
  await admin.from('facebook_comment_bridges').upsert(
    {
      page_id: args.job.page_id,
      user_id: args.job.user_id,
      fb_comment_id: args.comment.id,
      commenter_id: args.comment.commenterId,
      commenter_name: args.comment.commenterName,
      message: args.comment.message,
      private_reply_message_id: args.privateReplyMessageId,
      expires_at: new Date(Date.now() + BRIDGE_TTL_MS).toISOString(),
    },
    { onConflict: 'fb_comment_id' },
  )
}

async function markDone(
  admin: AdminClient,
  jobId: string,
  status: 'done' | 'skipped',
  reason: string | null,
): Promise<void> {
  await admin
    .from('facebook_comment_jobs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      started_at: null,
      last_error: reason,
    })
    .eq('id', jobId)
}

async function retryOrFail(admin: AdminClient, job: CommentJob, error: unknown): Promise<void> {
  const attempts = job.attempts + 1
  const failed = attempts >= MAX_ATTEMPTS
  const msg = error instanceof Error ? error.message : String(error)
  console.error('[comments.worker] job error', job.id, msg)

  await admin
    .from('facebook_comment_jobs')
    .update({
      status: failed ? 'failed' : 'queued',
      attempts,
      last_error: msg.slice(0, 1000),
      scheduled_at: new Date(Date.now() + Math.min(60_000 * attempts, 300_000)).toISOString(),
      finished_at: failed ? new Date().toISOString() : null,
      started_at: null,
    })
    .eq('id', job.id)
}
