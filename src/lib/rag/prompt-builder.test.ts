import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt-builder';
import type { GradedBuckets } from './grader';
import type { RetrievedChunk } from './retriever';

const chunk = (id: string, content: string, score: number, heading: string | null = null): RetrievedChunk & { score: number } => ({
  id,
  document_id: 'd',
  faq_id: null,
  content,
  heading_path: heading,
  score,
});

const buckets = (useful: (RetrievedChunk & { score: number })[] = [], ambiguous: (RetrievedChunk & { score: number })[] = []): GradedBuckets<RetrievedChunk> => ({
  useful,
  ambiguous,
  reject: [],
});

describe('buildPrompt', () => {
  it('orders useful + ambiguous by score and respects maxContext', () => {
    const r = buildPrompt({
      userQuery: 'How to refund?',
      buckets: buckets(
        [chunk('a', 'A txt', 0.9, 'Refunds')],
        [chunk('b', 'B txt', 0.5, 'Returns'), chunk('c', 'C txt', 0.45)],
      ),
      maxContext: 2,
    });
    expect(r.contextChunkIds).toEqual(['a', 'b']);
    // Heading paths must NOT leak into the prompt — they were causing the LLM
    // to echo source titles inline in user-facing replies.
    expect(r.system).not.toContain('(Refunds)');
    expect(r.system).not.toContain('(Returns)');
    expect(r.system).toContain('A txt');
    expect(r.system).toContain('B txt');
  });

  it('handles empty context gracefully', () => {
    const r = buildPrompt({ userQuery: 'q', buckets: buckets() });
    expect(r.system).toContain('(no relevant context found)');
    expect(r.contextChunkIds).toEqual([]);
  });

  it('uses legacy freeform persona override', () => {
    const r = buildPrompt({ userQuery: 'q', buckets: buckets(), persona: 'CUSTOM PERSONA' });
    expect(r.system.startsWith('CUSTOM PERSONA')).toBe(true);
  });

  it('renders structured config sections', () => {
    const r = buildPrompt({
      userQuery: 'q',
      buckets: buckets(),
      config: {
        name: 'Bea',
        persona: 'You help customers of Bea\'s Bakery.',
        doRules: ['Be friendly.', 'Confirm pickup time.'],
        dontRules: ['Never quote prices that are not listed.'],
        fallbackMessage: 'Hindi ko sure, ako-check muna.',
      },
    });
    expect(r.system).toContain('You are Bea.');
    expect(r.system).toContain('# Rules — DO');
    expect(r.system).toContain('1. Be friendly.');
    expect(r.system).toContain('2. Confirm pickup time.');
    expect(r.system).toContain('# Rules — DON\'T');
    expect(r.system).toContain('1. Never quote prices that are not listed.');
    expect(r.system).toContain('"Hindi ko sure, ako-check muna."');
  });

  it('falls back to default persona when no config given', () => {
    const r = buildPrompt({ userQuery: 'q', buckets: buckets() });
    expect(r.system).toContain('# Identity');
    expect(r.system).toContain('# Grounding');
  });
});
