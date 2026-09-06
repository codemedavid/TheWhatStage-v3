// Only same-origin relative paths may be used as a post-login destination.
// Rejects protocol-relative ("//evil"), scheme-carrying, and control-char
// values so the login form can never be turned into an open redirect.
const MAX_LEN = 4096
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/

export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_LEN) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  if (CONTROL_CHARS_RE.test(value)) return null
  return value
}
