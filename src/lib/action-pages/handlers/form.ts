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

// Same basic email shape the sales handler enforces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseFormSubmission(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): ParsedSubmission {
  const cfg = parseFormConfig(config)
  const fields: Record<string, unknown> = {}
  // Collect missing required fields and throw a single combined error at the
  // end (mirrors the sales handler). Format/whitelist failures throw inline.
  const missingRequired: string[] = []

  const fieldBlocks = cfg.blocks.filter(
    (b): b is FieldBlock => b.type === 'field',
  )

  for (const block of fieldBlocks) {
    const raw = payload[block.key]

    if (block.field_kind === 'checkbox') {
      // Checkboxes always coerce to boolean. A missing checkbox is `false`,
      // not "missing", unless explicitly required.
      if (isMissing(raw)) {
        if (block.required) missingRequired.push(block.label)
        fields[block.key] = false
      } else {
        fields[block.key] = coerceCheckbox(raw)
      }
      continue
    }

    if (isMissing(raw)) {
      // Required missing => collected for a combined throw; optional empty
      // fields are silently skipped as before.
      if (block.required) missingRequired.push(block.label)
      continue
    }

    switch (block.field_kind) {
      case 'email': {
        if (!EMAIL_RE.test(String(raw).trim())) {
          throw new Error(`Invalid email: ${block.label}`)
        }
        fields[block.key] = raw
        break
      }
      case 'number': {
        // Coerce to a real number; reject anything non-numeric. Store the
        // coerced number, not the raw string.
        const num =
          typeof raw === 'number' ? raw : Number(String(raw).trim())
        if (!Number.isFinite(num)) {
          throw new Error(`Invalid number: ${block.label}`)
        }
        fields[block.key] = num
        break
      }
      case 'select':
      case 'radio': {
        // The submitted value must be one of the configured option values.
        // If no options are configured, there is nothing to whitelist against.
        const options = block.options ?? []
        if (options.length > 0) {
          const allowed = options.some((o) => o.value === String(raw))
          if (!allowed) {
            throw new Error(`Invalid selection: ${block.label}`)
          }
        }
        fields[block.key] = raw
        break
      }
      default: {
        fields[block.key] = raw
      }
    }
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required field(s): ${missingRequired.join(', ')}`,
    )
  }

  return { outcome: 'submitted', data: { fields } }
}

registerHandler('form', parseFormSubmission)
