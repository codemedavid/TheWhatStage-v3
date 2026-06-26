/**
 * Real-transcript replay harness for the classify token-reduction work.
 *
 * Pulls the dominant tenant's most recent real conversations, replays each
 * thread's latest inbound turn through the LIVE combined classify call
 * (answerWithClassification) on the CURRENT build (compressed static prose +
 * recoverReply), and records per-turn:
 *   - prompt / cached / completion tokens (from the [chatbot.classify] log)
 *   - whether a second chatbot.answer.fallback LLM call fired
 *   - whether recoverReply salvaged the reply (skipped a fallback)
 *   - the reply text + whether an action_page was attached, so we can eyeball
 *     that compression did NOT regress the no-link/button/form guardrail
 *
 * It writes a JSON report and prints a compact summary. Compare avg prompt
 * tokens against the production ledger baseline (chatbot.classify avg ~8,569
 * prompt tok, 33.4% cache, 15.2% fallback rate) to confirm the reduction.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/token-eval/replay-classify.ts [N]
 * Env:
 *   TARGET_USER_ID  tenant to replay (default = dominant tenant)
 *   N (argv[2])     number of threads to sample (default 8)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { answerWithClassification } from '../../src/lib/chatbot/classify'
import { getChatbotConfig } from '../../src/lib/chatbot/config'
import type { StageBrief, ActionPageBrief } from '../../src/lib/chatbot/classify'
import type { AnswerHistory } from '../../src/lib/chatbot/answer'

const TARGET_USER_ID = process.env.TARGET_USER_ID ?? '1c1f133e-0a4a-4e37-9af8-36e538fc60f2'
const N = Number(process.argv[2] ?? 8)
const HISTORY_LIMIT = 40

// Surface the raw model output on a parse failure so we can classify WHY a turn
// would have fallen back (drives the recoverReply coverage analysis).
process.env.CLASSIFY_DEBUG_RAW = '1'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
const admin = createClient(url, key)

type MsgRow = { id: string; direction: string; body: string | null; created_at: string }
type TurnMetric = {
  threadId: string
  historyTurns: number
  promptTokens: number | null
  cachedPromptTokens: number | null
  completionTokens: number | null
  cachePct: number | null
  fallbackFired: boolean
  salvaged: boolean
  parseFailed: boolean
  actionPageSet: boolean
  leakInReply: boolean
  replyPreview: string
}

// Words that must NEVER appear in a reply that sets an action_page (the IRON
// RULE). Used only as a coarse leak detector for the quality spot-check.
const LEAK_WORDS = ['http', 'fill out', 'i-fill', 'click the', 'i-click', 'tap the', 'link sa', 'heto ang link', 'form sa', '[link]', '[insert']

function hasLeak(reply: string): boolean {
  const r = reply.toLowerCase()
  return LEAK_WORDS.some((w) => r.includes(w))
}

async function loadActionPages(userId: string): Promise<ActionPageBrief[]> {
  const { data } = await admin
    .from('action_pages')
    .select('id, title, cta_label, bot_send_instructions, status')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('cta_label', 'is', null)
    .not('bot_send_instructions', 'is', null)
  return (data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    cta_label: p.cta_label as string,
    bot_send_instructions: p.bot_send_instructions as string,
  }))
}

async function loadStages(userId: string): Promise<StageBrief[]> {
  const { data } = await admin
    .from('pipeline_stages')
    .select('id, name, description, position, kind, entry_signals, exit_signals')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  return (data ?? []) as StageBrief[]
}

async function recentThreadIds(userId: string, limit: number): Promise<string[]> {
  // Most-recently-active distinct threads. loadThreadTurn() then replays each
  // thread's LAST inbound message (skips threads with no inbound).
  const { data } = await admin
    .from('messenger_messages')
    .select('thread_id, created_at')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(2000)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of data ?? []) {
    const tid = row.thread_id as string
    if (seen.has(tid)) continue
    seen.add(tid)
    ids.push(tid)
    if (ids.length >= limit) break
  }
  return ids
}

async function loadThreadTurn(threadId: string): Promise<{ message: string; history: AnswerHistory } | null> {
  const { data } = await admin
    .from('messenger_messages')
    .select('id, direction, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  const msgs = (data ?? []) as MsgRow[]
  // Find the LAST inbound message: that is the turn we answer.
  let lastInboundIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === 'inbound' && msgs[i].body?.trim()) {
      lastInboundIdx = i
      break
    }
  }
  if (lastInboundIdx === -1) return null
  const message = msgs[lastInboundIdx].body!.trim()
  const prior = msgs.slice(0, lastInboundIdx).filter((m) => m.body?.trim())
  const history: AnswerHistory = prior
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.body!.trim() }))
  return { message, history }
}

async function main(): Promise<void> {
  const [config, stages, actionPages] = await Promise.all([
    getChatbotConfig(admin, TARGET_USER_ID),
    loadStages(TARGET_USER_ID),
    loadActionPages(TARGET_USER_ID),
  ])
  const threadIds = await recentThreadIds(TARGET_USER_ID, N)
  console.error(`[replay] tenant=${TARGET_USER_ID} threads=${threadIds.length} stages=${stages.length} pages=${actionPages.length}`)

  const metrics: TurnMetric[] = []
  const origLog = console.log.bind(console)

  for (const threadId of threadIds) {
    const turn = await loadThreadTurn(threadId)
    if (!turn) continue

    // Capture the structured logs this turn emits.
    let promptTokens: number | null = null
    let cachedPromptTokens: number | null = null
    let completionTokens: number | null = null
    let fallbackFired = false
    let salvaged = false
    let parseFailed = false
    console.log = (...args: unknown[]) => {
      const tag = typeof args[0] === 'string' ? args[0] : ''
      const payload = (args[1] ?? {}) as Record<string, unknown>
      if (tag === '[chatbot.classify]') {
        promptTokens = (payload.promptTokens as number) ?? null
        cachedPromptTokens = (payload.cachedPromptTokens as number) ?? null
        completionTokens = (payload.completionTokens as number) ?? null
      } else if (tag.startsWith('[chatbot.answer.fallback]')) {
        fallbackFired = true
      } else if (tag.startsWith('[chatbot.classify.salvage]')) {
        // recoverReply rescued the reply from a parse failure (Lever B).
        salvaged = true
      } else if (tag.startsWith('[classify.debug.raw]')) {
        parseFailed = true
      }
    }

    try {
      const result = await answerWithClassification(
        admin,
        TARGET_USER_ID,
        turn.message,
        turn.history,
        stages,
        null,
        { actionPages, threadId, preloadedConfig: config },
      )
      console.log = origLog
      const reply = (result?.text ?? '').toString()
      const actionPageSet = !!result?.actionPage
      const cachePct =
        promptTokens && promptTokens > 0
          ? Math.round((1000 * (cachedPromptTokens ?? 0)) / promptTokens) / 10
          : null
      metrics.push({
        threadId,
        historyTurns: turn.history.length,
        promptTokens,
        cachedPromptTokens,
        completionTokens,
        cachePct,
        fallbackFired,
        salvaged,
        parseFailed,
        actionPageSet,
        leakInReply: actionPageSet && hasLeak(reply),
        replyPreview: reply.slice(0, 180),
      })
      origLog(`[replay] ${threadId.slice(0, 8)} prompt=${promptTokens} cache=${cachePct}% fb=${fallbackFired} salv=${salvaged} ap=${actionPageSet}`)
    } catch (e) {
      console.log = origLog
      origLog(`[replay] ${threadId.slice(0, 8)} ERROR ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const ok = metrics.filter((m) => m.promptTokens != null)
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const summary = {
    tenant: TARGET_USER_ID,
    turns: metrics.length,
    avgPromptTokens: avg(ok.map((m) => m.promptTokens!)),
    avgCachePct: ok.length ? Math.round((10 * ok.reduce((a, m) => a + (m.cachePct ?? 0), 0)) / ok.length) / 10 : 0,
    avgCompletionTokens: avg(ok.map((m) => m.completionTokens ?? 0)),
    fallbackRate: metrics.length ? Math.round((1000 * metrics.filter((m) => m.fallbackFired).length) / metrics.length) / 10 : 0,
    salvageRate: metrics.length ? Math.round((1000 * metrics.filter((m) => m.salvaged).length) / metrics.length) / 10 : 0,
    parseFailRate: metrics.length ? Math.round((1000 * metrics.filter((m) => m.parseFailed).length) / metrics.length) / 10 : 0,
    leakCount: metrics.filter((m) => m.leakInReply).length,
  }

  mkdirSync('scripts/token-eval/out', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = `scripts/token-eval/out/replay-${stamp}.json`
  writeFileSync(outPath, JSON.stringify({ summary, metrics }, null, 2))
  console.error('\n=== SUMMARY ===')
  console.error(JSON.stringify(summary, null, 2))
  console.error(`\nWrote ${outPath}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
