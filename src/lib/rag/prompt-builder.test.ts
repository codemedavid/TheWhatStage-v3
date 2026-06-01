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
    it('cache_friendly: a DATE-resolution time block trails after the KB context (no minute time in the prefix)', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'cache_friendly';
      try {
        const { system } = buildPrompt({
          userQuery: 'hello',
          buckets: { useful: [], ambiguous: [], reject: [] },
          config: {},
          maxContext: 5,
        });
        // The timestamp must NOT be the prefix (it would bust the provider
        // prompt cache). It lives at the tail, after the KB context, and at
        // DATE resolution (no HH:MM) so it rotates only once per day.
        expect(system.startsWith('Current date:')).toBe(false);
        expect(system).toContain('Asia/Manila');
        const idxDate = system.indexOf('Current date:');
        const idxKb = system.indexOf('# Knowledge base context');
        expect(idxDate).toBeGreaterThan(idxKb);
        // No minute-resolution time anywhere in cache_friendly built.system.
        expect(system).not.toContain('Current time:');
        // The stable safety prefix should lead instead.
        expect(system.indexOf('# Ground rules')).toBeLessThan(idxDate);
      } finally {
        ragConfig.promptLayout = original;
      }
    });

    it('legacy: keeps the MINUTE-resolution "Current time: ... HH:MM" line at the END (regression pin)', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'legacy';
      try {
        const { system } = buildPrompt({
          userQuery: 'hello',
          buckets: buckets([chunk('a', 'KB-CHUNK', 0.9)]),
          config: {},
          maxContext: 5,
        });
        expect(system).toContain('Asia/Manila');
        const idxTime = system.indexOf('Current time:');
        const idxKb = system.indexOf('# Knowledge base context');
        expect(idxTime).toBeGreaterThan(idxKb);
        // Minute resolution preserved: "Current time: <date>, HH:MM (...)".
        expect(system).toMatch(/Current time:[^\n]*\d{1,2}:\d{2}/);
      } finally {
        ragConfig.promptLayout = original;
      }
    });
  });

  describe('staticPrefix / volatileTail split (cache_friendly default-persona path)', () => {
    it('exposes staticPrefix and volatileTail with the static rules in the prefix and volatile data in the tail', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'cache_friendly';
      try {
        const r = buildPrompt({
          userQuery: 'q',
          buckets: buckets([chunk('a', 'KB-CHUNK', 0.9)]),
          config: { funnelInstruction: 'GOAL-TEXT', instructions: 'INSTR-TEXT' },
          conversationSummary: 'SUMMARY-TEXT',
          paymentEnumBlock: 'Available Payment Methods:\n- GCash: 0917',
        });
        expect(r.staticPrefix).toBeDefined();
        expect(r.volatileTail).toBeDefined();
        const sp = r.staticPrefix!;
        const vt = r.volatileTail!;
        // Static prefix: persona/rules/grounding/fallback only.
        expect(sp).toContain('# Ground rules');
        expect(sp).toContain('# Identity');
        expect(sp).toContain('# Grounding');
        expect(sp).toContain('# Fallback');
        // Static prefix must NOT contain any volatile content.
        expect(sp).not.toContain('# Knowledge base context');
        expect(sp).not.toContain('KB-CHUNK');
        expect(sp).not.toContain('SUMMARY-TEXT');
        expect(sp).not.toContain('Available Payment Methods');
        expect(sp).not.toContain('Current time:');
        expect(sp).not.toContain('Current date:');
        // Volatile tail: goal, instructions, summary, payment, KB.
        expect(vt).toContain('GOAL-TEXT');
        expect(vt).toContain('INSTR-TEXT');
        expect(vt).toContain('SUMMARY-TEXT');
        expect(vt).toContain('Available Payment Methods');
        expect(vt).toContain('KB-CHUNK');
        // No time block leaks into the tail — classify owns the single append.
        expect(vt).not.toContain('Current date:');
        expect(vt).not.toContain('Current time:');
      } finally {
        ragConfig.promptLayout = original;
      }
    });

    it('leaves staticPrefix/volatileTail undefined on the freeform persona override path', () => {
      const r = buildPrompt({ userQuery: 'q', buckets: buckets(), persona: 'CUSTOM PERSONA' });
      expect(r.staticPrefix).toBeUndefined();
      expect(r.volatileTail).toBeUndefined();
      expect(r.system).toContain('CUSTOM PERSONA');
      expect(r.system).toContain('# Knowledge base context');
    });

    it('leaves staticPrefix/volatileTail undefined in legacy layout', () => {
      const original = ragConfig.promptLayout;
      ragConfig.promptLayout = 'legacy';
      try {
        const r = buildPrompt({ userQuery: 'q', buckets: buckets(), config: {} });
        expect(r.staticPrefix).toBeUndefined();
        expect(r.volatileTail).toBeUndefined();
      } finally {
        ragConfig.promptLayout = original;
      }
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
