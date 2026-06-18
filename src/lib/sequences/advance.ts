// Pure, dependency-free state transition for a follow-up sequence run. Kept in
// its own module (no Supabase / crypto / LLM imports) so it is unit-testable in
// isolation. Shared by the project- and lead-sequence workers via shared.ts.

// After a step is sent: either the sequence is done, or it advances to the next
// step with a next_run_at computed from the enrollment anchor (started_at) plus
// that step's cumulative delay.
export function nextSequenceState(
  startedAtIso: string,
  steps: Array<{ delay_minutes: number }>,
  currentStepIdx: number,
): { done: true } | { done: false; nextStepIdx: number; nextRunAt: string } {
  if (currentStepIdx >= steps.length - 1) return { done: true }
  const nextStepIdx = currentStepIdx + 1
  const nextRunAt = new Date(
    Date.parse(startedAtIso) + steps[nextStepIdx].delay_minutes * 60_000,
  ).toISOString()
  return { done: false, nextStepIdx, nextRunAt }
}
