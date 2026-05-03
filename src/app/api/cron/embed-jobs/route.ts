import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueuePendingSources, runDueJobs } from '@/lib/rag/worker/embed-job';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Supabase Cron entry point. Scheduled from pg_cron via pg_net.
 * Authentication: scheduled requests send `Authorization: Bearer ${CRON_SECRET}`;
 * we verify it to keep ad-hoc external calls out.
 */
export async function GET(req: Request) {
  // In production we require the cron bearer token. In dev we let
  // requests through so you can hit this endpoint from a browser or curl.
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    const auth = req.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const client = createAdminClient();

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
    async fetchBusinessItem(id: string) {
      const { data, error } = await client
        .from('business_items')
        .select('title, rag_text, version, status, rag_enabled')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(`business item ${id} missing: ${error?.message}`);
      return {
        title: data.title,
        ragText: data.rag_text,
        version: data.version,
        status: data.status,
        ragEnabled: data.rag_enabled,
      };
    },
  };

  const { enqueued } = await enqueuePendingSources(client, { limit: 50 });
  const { processed } = await runDueJobs(client, fetchers, {
    limit: 10,
    log: {
      info: (msg, meta) => console.log(JSON.stringify({ msg, ...meta })),
      error: (msg, meta) => console.error(JSON.stringify({ msg, ...meta })),
    },
  });

  return NextResponse.json({ enqueued, processed });
}
