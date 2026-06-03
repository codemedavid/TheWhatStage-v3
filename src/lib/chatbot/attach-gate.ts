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

/**
 * Cross-turn dedup gate for knowledge-media assets (the @asset/#folder "proof
 * screenshot" path), mirroring firstMentionGate for source images.
 *
 * Candidates are assumed to already be in send-priority (relevance) order.
 * An asset is dropped when:
 *  - it was already sent earlier in THIS job (`sentAssetIds`) — always skipped,
 *    even on visual intent, so a single turn never double-sends; OR
 *  - it was already shown on a PRIOR turn (its `media:<id>` key is in
 *    `attachedItemKeys`) AND the customer is not asking to see images again.
 *
 * Visual intent ("show me / pakita") re-approves prior-turn assets so a
 * deliberate re-ask still re-sends. Returns up to `maxPerTurn` eligible assets.
 */
export function filterAttachableMedia<T extends { id: string }>(input: {
  candidates: T[];
  sentAssetIds: string[];
  attachedItemKeys: string[];
  customerText: string;
  maxPerTurn?: number;
}): T[] {
  const cap = input.maxPerTurn ?? 4;
  const sent = new Set(input.sentAssetIds);
  const attached = new Set(input.attachedItemKeys);
  const visualIntent = hasVisualIntent(input.customerText);

  const out: T[] = [];
  for (const asset of input.candidates) {
    if (out.length >= cap) break;
    if (sent.has(asset.id)) continue;
    if (attached.has(mediaAttachKey(asset.id)) && !visualIntent) continue;
    out.push(asset);
  }
  return out;
}

/** Cross-turn dedup key for a knowledge-media asset, stored in
 *  thread.attached_item_keys alongside source-image keys (product:/payment:). */
export function mediaAttachKey(assetId: string): string {
  return `media:${assetId}`;
}
