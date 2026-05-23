// src/lib/chatbot/attach-gate.ts
import { hasVisualIntent } from './visual-intent';
import type { SourceImage } from './source-images';

export interface FirstMentionGateInput {
  attachedItemKeys: string[];
  candidates: SourceImage[];
  customerText: string;
  maxPerTurn?: number;
}

export interface FirstMentionGateResult {
  approved: SourceImage[];
  newKeys: string[];
}

export function firstMentionGate(input: FirstMentionGateInput): FirstMentionGateResult {
  const cap = input.maxPerTurn ?? 3;
  const attached = new Set(input.attachedItemKeys);
  const visualIntent = hasVisualIntent(input.customerText);

  const eligible: SourceImage[] = [];
  for (const c of input.candidates) {
    const seen = attached.has(c.sourceKey);
    if (!seen || visualIntent) eligible.push(c);
  }

  eligible.sort((a, b) => b.rerankerScore - a.rerankerScore);
  const approved = eligible.slice(0, cap);
  const newKeys = approved.filter((c) => !attached.has(c.sourceKey)).map((c) => c.sourceKey);

  return { approved, newKeys };
}
