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
 * Default handler — every kind starts with this until its kind-specific
 * handler is wired up. It accepts any payload and tags it with outcome
 * "submitted". Pipeline rules can still match on "submitted".
 */
const defaultHandler: SubmissionHandler = (payload) => ({
  outcome: 'submitted',
  data: payload,
})

const HANDLERS: Partial<Record<ActionPageKind, SubmissionHandler>> = {}

export function parseSubmission(
  kind: ActionPageKind,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): ParsedSubmission {
  const handler = HANDLERS[kind] ?? defaultHandler
  return handler(payload, config)
}

export function registerHandler(kind: ActionPageKind, handler: SubmissionHandler): void {
  HANDLERS[kind] = handler
}
