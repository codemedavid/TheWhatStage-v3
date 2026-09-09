/**
 * How a media asset became a candidate for a chatbot turn.
 *  - asset_ref / folder_ref: an operator @slug / #folder token in a RETRIEVED
 *    knowledge chunk. Operator-tagged and query-relevant, so paths without a
 *    structured per-asset decision (plain `answer()`, JSON-parse fallback) may
 *    trust these.
 *  - instruction_ref: a token in the chatbot instructions / rules. Present on
 *    EVERY turn regardless of the customer's message, so only ever sent when the
 *    reply model explicitly picks it.
 *  - semantic: an `auto_send` asset ranked by its embedded name + description
 *    against the customer's message. Same rule — model pick only.
 */
export type MediaMatchReason = 'asset_ref' | 'folder_ref' | 'instruction_ref' | 'semantic'

/** Reasons that are safe to send without a per-asset model decision. */
export const KNOWLEDGE_REF_REASONS: readonly MediaMatchReason[] = ['asset_ref', 'folder_ref']

/** True for operator-tagged refs found in RETRIEVED knowledge (see MediaMatchReason). */
export function isKnowledgeRef(asset: { matchReason: MediaMatchReason }): boolean {
  return KNOWLEDGE_REF_REASONS.includes(asset.matchReason)
}
