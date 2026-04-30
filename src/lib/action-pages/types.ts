import type { ActionPageKind } from './kinds'

export interface ParsedSubmission {
  outcome: string
  data: Record<string, unknown>
}

export type SubmissionHandler = (
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
) => ParsedSubmission

/**
 * Per-kind submission handler.  Each kind PR registers its own at module
 * load time via `registerHandler` (see src/lib/action-pages/handlers).
 */
export interface KindHandlerModule {
  kind: ActionPageKind
  handler: SubmissionHandler
}
