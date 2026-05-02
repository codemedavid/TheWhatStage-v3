/**
 * Local-dev RAG embed worker.
 *
 * Runs the same code path as the Vercel Cron route, but in a long-running
 * loop so you can develop without scheduling. Stop with Ctrl+C.
 *
 *   npm run rag:work          # poll every 3s
 *   npm run rag:work -- --once  # process one batch and exit
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + HF_TOKEN.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const POLL_MS = Number(process.env.RAG_WORKER_POLL_MS ?? 3000);
const BATCH = Number(process.env.RAG_WORKER_BATCH ?? 5);
const ONCE = process.argv.includes('--once');

function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    for (const line of lines) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadDotEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.HF_TOKEN) {
  console.error('Missing HF_TOKEN');
  process.exit(1);
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fetchers = {
  async fetchDocument(id: string) {
    const { data, error } = await client
      .from('knowledge_documents')
      .select('title, content_json, version')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`document ${id} missing: ${error?.message}`);
    return { title: data.title, contentJson: data.content_json, version: data.version };
  },
  async fetchFaq(id: string) {
    const { data, error } = await client
      .from('knowledge_faqs')
      .select('question, answer, version')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`faq ${id} missing: ${error?.message}`);
    return { question: data.question, answer: data.answer, version: data.version };
  },
};

const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[rag] ${msg}`, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[rag] ${msg}`, meta ?? ''),
};

let running = true;
process.on('SIGINT', () => {
  console.log('\n[rag] shutting down…');
  running = false;
});

async function tick(
  worker: typeof import('../src/lib/rag/worker/embed-job'),
) {
  try {
    const queued = await worker.enqueuePendingSources(client, { limit: BATCH });
    if (queued.enqueued > 0) log.info('backfill', queued);
    const r = await worker.runDueJobs(client, fetchers, { limit: BATCH, log });
    if (r.processed > 0) log.info('tick', { processed: r.processed });
  } catch (err) {
    log.error('tick failed', { error: String(err) });
  }
}

(async () => {
  const worker = await import('../src/lib/rag/worker/embed-job');
  log.info('worker started', { pollMs: POLL_MS, batch: BATCH, once: ONCE });
  if (ONCE) {
    await tick(worker);
    return;
  }
  while (running) {
    await tick(worker);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
