import { registerHandler, type ParsedSubmission } from '../dispatch'
import {
  parseFormConfig,
  type FieldBlock,
} from '@/app/a/[slug]/_kinds/form/schema'

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

function coerceCheckbox(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.toLowerCase()
    return v === 'true' || v === 'on' || v === '1' || v === 'yes'
  }
  if (typeof value === 'number') return value !== 0
  return false
}

export function parseFormSubmission(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): ParsedSubmission {
  const cfg = parseFormConfig(config)
  const fields: Record<string, unknown> = {}
  const validationErrors: string[] = []

  const fieldBlocks = cfg.blocks.filter(
    (b): b is FieldBlock => b.type === 'field',
  )

  for (const block of fieldBlocks) {
    const raw = payload[block.key]

    if (block.field_kind === 'checkbox') {
      // Checkboxes always coerce to boolean. A missing checkbox is `false`,
      // not "missing", unless explicitly required.
      if (isMissing(raw)) {
        if (block.required) {
          validationErrors.push(block.key)
        }
        fields[block.key] = false
      } else {
        fields[block.key] = coerceCheckbox(raw)
      }
      continue
    }

    if (isMissing(raw)) {
      if (block.required) validationErrors.push(block.key)
      continue
    }

    fields[block.key] = raw
  }

  const data: Record<string, unknown> = { fields }
  if (validationErrors.length > 0) {
    data.meta = { validation_errors: validationErrors }
  }

  return { outcome: 'submitted', data }
}

registerHandler('form', parseFormSubmission)
