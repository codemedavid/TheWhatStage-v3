import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt-builder';
import { ragConfig } from './config';
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
    expect(r.system).toContain('CUSTOM PERSONA');
    expect(r.system).toContain('# Knowledge base context');
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

  describe('current time injection', () => {
    it('includes a "Current time" line at the END of the system prompt (cache-friendly: volatile timestamp out of the stable prefix)', () => {
      const { system } = buildPrompt({
        userQuery: 'hello',
        buckets: { useful: [], ambiguous: [], reject: [] },
        config: {},
        maxContext: 5,
      });
      // H1: the per-minute timestamp must NOT be the prefix (it would bust the
      // provider prompt cache). It now lives at the tail, after the KB context.
      expect(system.startsWith('Current time:')).toBe(false);
      expect(system).toContain('Asia/Manila');
      const idxTime = system.indexOf('Current time:');
      const idxKb = system.indexOf('# Knowledge base context');
      expect(idxTime).toBeGreaterThan(idxKb);
      // The stable safety prefix should lead instead.
      expect(system.indexOf('# Ground rules')).toBeLessThan(idxTime);
    });
  });

  describe('prompt layout', () => {
    it('cache_friendly puts stable Identity/Rules before volatile goal/instructions/KB', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'cache_friendly';
      try {
        const r = buildPrompt({
          userQuery: 'q',
          buckets: buckets([chunk('a', 'KB-CHUNK', 0.9)]),
          config: {
            funnelInstruction: 'GOAL-TEXT',
            instructions: 'INSTR-TEXT',
          },
          conversationSummary: 'SUMMARY-TEXT',
        });
        const idxIdentity = r.system.indexOf('# Identity');
        const idxGoal = r.system.indexOf('GOAL-TEXT');
        const idxInstr = r.system.indexOf('INSTR-TEXT');
        const idxSummary = r.system.indexOf('SUMMARY-TEXT');
        const idxKb = r.system.indexOf('KB-CHUNK');
        expect(idxIdentity).toBeGreaterThanOrEqual(0);
        expect(idxIdentity).toBeLessThan(idxGoal);
        expect(idxGoal).toBeLessThan(idxInstr);
        expect(idxInstr).toBeLessThan(idxSummary);
        expect(idxSummary).toBeLessThan(idxKb);
      } finally {
        ragConfig.promptLayout = original;
      }
    });

    it('legacy preserves goal/instructions BEFORE Identity (pre-2026-05 order)', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'legacy';
      try {
        const r = buildPrompt({
          userQuery: 'q',
          buckets: buckets([chunk('a', 'KB-CHUNK', 0.9)]),
          config: {
            funnelInstruction: 'GOAL-TEXT',
            instructions: 'INSTR-TEXT',
          },
          conversationSummary: 'SUMMARY-TEXT',
        });
        const idxGoal = r.system.indexOf('GOAL-TEXT');
        const idxInstr = r.system.indexOf('INSTR-TEXT');
        const idxIdentity = r.system.indexOf('# Identity');
        const idxSummary = r.system.indexOf('SUMMARY-TEXT');
        const idxKb = r.system.indexOf('KB-CHUNK');
        expect(idxGoal).toBeLessThan(idxInstr);
        expect(idxInstr).toBeLessThan(idxIdentity);
        expect(idxIdentity).toBeLessThan(idxSummary);
        expect(idxSummary).toBeLessThan(idxKb);
      } finally {
        ragConfig.promptLayout = original;
      }
    });
  });
});

describe('buildPrompt — payment enum block', () => {
  it('injects the payment enum block above the KB context', () => {
    const r = buildPrompt({
      userQuery: 'how do I pay?',
      buckets: buckets([chunk('a', 'product info', 0.9)]),
      paymentEnumBlock: 'Available Payment Methods:\n- GCash: 0917-123-4567',
    });
    expect(r.system).toContain('Available Payment Methods');
    expect(r.system.indexOf('Available Payment Methods'))
      .toBeLessThan(r.system.indexOf('product info'));
  });

  it('does not inject anything when paymentEnumBlock is empty', () => {
    const r = buildPrompt({
      userQuery: 'q',
      buckets: buckets(),
      paymentEnumBlock: '',
    });
    expect(r.system).not.toContain('Available Payment Methods');
  });

  it('does not inject anything when paymentEnumBlock is omitted', () => {
    const r = buildPrompt({ userQuery: 'q', buckets: buckets() });
    expect(r.system).not.toContain('Available Payment Methods');
  });
});
