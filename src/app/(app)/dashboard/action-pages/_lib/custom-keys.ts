import type { ActionPageKind } from '@/lib/action-pages/kinds'

export function extractCustomKeysFromConfig(
  kind: ActionPageKind,
  config: Record<string, unknown>,
): string[] {
  if (kind === 'catalog') {
    const fields = (config.checkout_fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields.map((f) => (typeof f.key === 'string' ? f.key : '')).filter(Boolean)
  }
  if (kind === 'booking') {
    const form = (config.form as Record<string, unknown> | undefined) ?? {}
    const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields.map((f) => (typeof f.key === 'string' ? f.key : '')).filter(Boolean)
  }
  return []
}
