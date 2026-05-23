'use server'

import { z } from 'zod'
import { isActionPageKind } from '@/lib/action-pages/kinds'
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import { knownPathsForKind, sampleContextForKind } from '@/lib/action-pages/echo/variables'

const Input = z.object({
  kind: z.string(),
  template: z.string().max(640),
  customKeys: z.array(z.string()).max(40).default([]),
})

export interface PreviewEchoResult {
  text: string
  warnings: { token: string; reason: 'unknown' | 'malformed' }[]
}

export async function previewEcho(input: unknown): Promise<PreviewEchoResult> {
  const parsed = Input.parse(input)
  if (!isActionPageKind(parsed.kind)) {
    return { text: '', warnings: [{ token: parsed.kind, reason: 'unknown' }] }
  }
  const known = knownPathsForKind(parsed.kind, parsed.customKeys)
  const ctx = sampleContextForKind(parsed.kind, parsed.customKeys)
  const { text, warnings } = renderEchoTemplate(parsed.template, ctx, known)
  return { text, warnings }
}
