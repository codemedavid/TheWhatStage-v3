export interface RenderWarning {
  token: string
  reason: 'unknown' | 'malformed'
}

export interface RenderResult {
  text: string
  warnings: RenderWarning[]
}

const PLACEHOLDER_RE = /\{\{([\s\S]*?)\}\}/g
const PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
const MAX_PLACEHOLDERS = 500
const DENIED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function renderEchoTemplate(
  template: string,
  ctx: Record<string, unknown>,
  known: Set<string>,
): RenderResult {
  const warnings: RenderWarning[] = []
  let count = 0

  const out = template.replace(PLACEHOLDER_RE, (_match, inner: string) => {
    count += 1
    if (count > MAX_PLACEHOLDERS) {
      throw new Error('echo template has too many placeholders')
    }
    const expr = inner.trim()

    // Bare {{}} — malformed
    if (expr === '') {
      warnings.push({ token: '', reason: 'malformed' })
      return '{{}}'
    }

    const operands = splitOnPipe(expr)

    // Check each operand is either a valid path or a quoted literal
    for (const op of operands) {
      if (isQuotedLiteral(op)) continue
      if (PATH_RE.test(op)) continue
      // Malformed operand (e.g. #if, /if)
      warnings.push({ token: expr, reason: 'malformed' })
      return `{{${inner}}}`
    }

    // Evaluate the chain
    for (const op of operands) {
      if (isQuotedLiteral(op)) return stripQuotes(op)
      if (!known.has(op)) {
        warnings.push({ token: op, reason: 'unknown' })
        continue
      }
      const value = lookup(ctx, op)
      if (value !== undefined && value !== null && String(value).length > 0) {
        return String(value)
      }
    }
    return ''
  })

  return { text: out, warnings }
}

function splitOnPipe(expr: string): string[] {
  const operands: string[] = []
  let current = ''
  let inQuote = false
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
      i++
    } else if (!inQuote && ch === '|' && expr[i + 1] === '|') {
      operands.push(current.trim())
      current = ''
      i += 2
    } else {
      current += ch
      i++
    }
  }
  operands.push(current.trim())
  return operands.filter((op, idx, arr) => op.length > 0 || arr.length === 1)
}

function isQuotedLiteral(operand: string): boolean {
  return operand.length >= 2 && operand.startsWith('"') && operand.endsWith('"')
}

function stripQuotes(operand: string): string {
  return operand.slice(1, -1)
}

function lookup(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx
  for (const segment of path.split('.')) {
    if (DENIED_SEGMENTS.has(segment)) return undefined
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[segment]
  }
  return cur
}
