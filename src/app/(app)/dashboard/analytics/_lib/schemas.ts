import { z } from 'zod'

/** URL query state for the analytics dashboard. `range` drives the date bounds;
 * `source`/`campaign` narrow the lead cohort. Invalid values fall back safely. */
export const AnalyticsQuery = z.object({
  range: z.enum(['today', 'week', 'month', 'all', 'custom']).catch('month'),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  campaign: z.string().optional().catch(undefined),
})

export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>
