import { ragConfig } from '@/lib/rag/config'
import type { ReplyIntent } from './intent'

/**
 * Select the reply model for a given turn.
 *
 * Returns `ragConfig.classifierModel` (the cheap 8B model) when the intent is
 * simple (smalltalk or faq) AND the context carries no stages or action pages.
 *
 * Otherwise returns `undefined` so the caller falls back to the default strong
 * model. This guard keeps structured/sales turns on the strong model to avoid
 * quality regressions — e.g. a sales turn needs persuasive copy and accurate
 * product detail; a turn with stages/action-pages may require precise slot
 * filling or dynamic UI generation that the 8B model handles poorly.
 */
export function selectReplyModel(opts: {
  intent: ReplyIntent
  hasStages: boolean
  hasActionPages: boolean
}): string | undefined {
  const { intent, hasStages, hasActionPages } = opts

  if ((intent === 'smalltalk' || intent === 'faq') && !hasStages && !hasActionPages) {
    return ragConfig.classifierModel
  }

  return undefined
}
