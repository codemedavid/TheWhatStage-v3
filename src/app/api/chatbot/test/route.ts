import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getChatbotConfig } from '@/lib/chatbot/config'
import { checkRateLimit } from '@/lib/chatbot/rate-limit'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  createReranker,
  retrieve,
} from '@/lib/rag'
import { selectMediaForReply } from '@/lib/media/selector'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SourceMeta = { id: string; title: string }

export async function POST(req: NextRequest) {
  const tAuth = Date.now()
  const supabase = await createClient()
  // getClaims() verifies the JWT locally (asymmetric keys) without a round
  // trip to Supabase Auth. Falls back to getUser() if claims aren't usable
  // (e.g. project still on legacy symmetric secret).
  const claimsRes = await supabase.auth.getClaims()
  let userId: string | undefined = claimsRes.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  console.log('[chat.timing] auth', { ms: Date.now() - tAuth })
  if (!userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rl = checkRateLimit(`chat:test:${userId}`)
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)),
      },
    })
  }

  // Kick off config fetch in parallel with body parsing — both depend only on
  // userId / the request stream, neither needs the other.
  const tConfig = Date.now()
  const configPromise = getChatbotConfig(supabase, userId).then((c) => {
    console.log('[chat.timing] config', { ms: Date.now() - tConfig })
    return c
  })

  let message = ''
  let history: { role: 'user' | 'assistant'; content: string }[] = []
  try {
    const body = (await req.json()) as {
      message?: unknown
      history?: unknown
    }
    message = typeof body.message === 'string' ? body.message.trim() : ''
    if (message.length > 4000) message = message.slice(0, 4000)
    if (Array.isArray(body.history)) {
      history = body.history
        .map((m) => {
          if (!m || typeof m !== 'object') return null
          const role = (m as { role?: unknown }).role
          const content = (m as { content?: unknown }).content
          if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
            const trimmed = content.trim()
            return trimmed ? { role, content: trimmed } : null
          }
          return null
        })
        .filter((m): m is { role: 'user' | 'assistant'; content: string } => m !== null)
        .slice(-20) // hard cap on prior turns
    }
  } catch {
    /* empty */
  }
  if (!message) {
    return new Response(JSON.stringify({ error: 'empty message' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const config = await configPromise

  const embedder = createEmbedder()
  const reranker = createReranker()
  const llm = new HfRouterLlm()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      // Flush an immediate event so proxies (ngrok, etc.) don't time out
      // the response while we do the slow retrieval work below.
      send({ type: 'ack' })
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode('\n'))
        } catch {
          // controller already closed
        }
      }, 10_000)

      try {
        const tRetrieve = Date.now()
        const ctx = await retrieve(
          { client: supabase, embedder, reranker, rewriteQuery: (q) => llm.rewriteQuery(q) },
          { userId: userId, query: message },
        )
        console.log('[chat.timing] retrieve', { ms: Date.now() - tRetrieve })

        const built = buildPrompt({
          userQuery: message,
          buckets: ctx.buckets,
          config,
          maxContext: config.maxContext,
        })

        // Kick off title resolution and media selection in parallel; emit when ready.
        const titlesPromise = resolveSourceTitles(supabase, userId, built.contextChunkIds)
          .then((titles) => {
            if (titles.length > 0) send({ type: 'sources', titles: titles.map((t) => t.title) })
          })
          .catch((err) => {
            console.warn('[chat] resolveSourceTitles failed', err)
          })

        const mediaPromise = selectMediaForReply({
          client: supabase,
          embedder,
          userId,
          customerMessage: message,
          retrievedChunks: [
            ...ctx.buckets.useful,
            ...ctx.buckets.ambiguous,
            ...ctx.buckets.reject,
          ],
          limit: 4,
        })
          .then(async (media) => {
            if (media.length === 0) return
            // Sign URLs server-side so TestChat can render thumbnails directly.
            const signed = await Promise.all(
              media.map(async (m) => {
                const { data } = await supabase.storage
                  .from('media-assets')
                  .createSignedUrl(m.storagePath, 3600)
                return { ...m, signedUrl: data?.signedUrl ?? null }
              }),
            )
            send({ type: 'media', media: signed })
          })
          .catch((err) => console.warn('[chat.test.media] selection failed', err))

        const messages = [
          { role: 'system' as const, content: built.system },
          ...history,
          { role: 'user' as const, content: built.user },
        ]

        const tFirstToken = Date.now()
        let gotFirst = false
        for await (const part of llm.stream(messages, {
          temperature: config.temperature,
          maxTokens: 800,
        })) {
          if (part.delta) {
            if (!gotFirst) {
              gotFirst = true
              console.log('[chat.timing] llm first token', { ms: Date.now() - tFirstToken })
            }
            send({ type: 'delta', text: part.delta })
          }
          if (part.done) break
        }
        console.log('[chat.timing] llm done', { ms: Date.now() - tFirstToken })
        await titlesPromise
        await mediaPromise
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: (err as Error)?.message ?? 'unknown error' })
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}

async function resolveSourceTitles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  chunkIds: string[],
): Promise<SourceMeta[]> {
  if (chunkIds.length === 0) return []

  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('id, document_id, faq_id')
    .eq('user_id', userId)
    .in('id', chunkIds)

  if (!chunks || chunks.length === 0) return []

  const docIds = Array.from(new Set(chunks.map((c) => c.document_id).filter(Boolean) as string[]))
  const faqIds = Array.from(new Set(chunks.map((c) => c.faq_id).filter(Boolean) as string[]))

  const [docsRes, faqsRes] = await Promise.all([
    docIds.length
      ? supabase.from('knowledge_documents').select('id, title').in('id', docIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    faqIds.length
      ? supabase.from('knowledge_faqs').select('id, question').in('id', faqIds)
      : Promise.resolve({ data: [] as { id: string; question: string }[] }),
  ])

  const docTitle = new Map((docsRes.data ?? []).map((d) => [d.id, d.title]))
  const faqTitle = new Map((faqsRes.data ?? []).map((f) => [f.id, f.question]))

  const seen = new Set<string>()
  const out: SourceMeta[] = []
  for (const c of chunks) {
    const title =
      (c.document_id && docTitle.get(c.document_id)) ||
      (c.faq_id && faqTitle.get(c.faq_id)) ||
      null
    if (title && !seen.has(title)) {
      seen.add(title)
      out.push({ id: c.id, title })
    }
  }
  return out
}
