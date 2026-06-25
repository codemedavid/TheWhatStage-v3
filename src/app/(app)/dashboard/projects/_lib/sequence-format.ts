// Shared formatting for follow-up sequence delays. Pure (no client boundary) so
// both the step editor and the no-send preview render identical timing labels.

export const DELAY_PRESETS: { label: string; minutes: number }[] = [
  { label: '5 min', minutes: 5 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
]

// Compact human label for a minutes offset from stage entry.
export function humanizeDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} d`
}
