// Manual-override layer for follow-up sequence steps. Every step is an AI touch
// by default; an operator may type a MANUAL message that is sent verbatim
// instead. Kept pure (no I/O) so the firing worker, the no-send preview, and the
// editor all share one definition of "is this step manual" — mirrors why
// ./draftPrompt (pure prompt assembly) is its own module.

// The verbatim text an operator wants sent for this step, or null when there is
// no override (blank/whitespace) — in which case the caller runs the AI draft
// path. Trims only the ends so intentional line breaks survive.
export function manualOverride(manualMessage: string | null | undefined): string | null {
  const trimmed = manualMessage?.trim()
  return trimmed ? trimmed : null
}

// The steps the AI must still draft: those WITHOUT a manual override. Filters
// (never re-indexes) so each kept step keeps its original `position`, which is
// how batch drafts are keyed — manual steps simply don't consume a draft slot
// or any tokens.
export function aiDraftSteps<T extends { manual_message?: string | null }>(steps: T[]): T[] {
  return steps.filter((s) => manualOverride(s.manual_message) === null)
}
