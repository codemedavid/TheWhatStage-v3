import type { ApiKeyScope } from '@/lib/api-keys/resolve'

export const OAUTH_SCOPES: readonly ApiKeyScope[] = ['read', 'send', 'projects']

export const SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  read: 'Read your leads, conversations, attachments, and projects',
  send: 'Send Messenger messages and action pages to your leads as you',
  projects: 'Create and manage projects and workspaces',
}

/**
 * Turn a space-delimited `scope` parameter into the scopes to grant. An
 * absent/empty scope means "everything" (most MCP clients send none).
 * Returns null when any requested scope is unknown.
 */
export function resolveRequestedScopes(scopeParam: string | null | undefined): ApiKeyScope[] | null {
  const requested = (scopeParam ?? '').split(/\s+/).filter(Boolean)
  if (requested.length === 0) return [...OAUTH_SCOPES]
  const known = new Set<string>(OAUTH_SCOPES)
  if (requested.some((s) => !known.has(s))) return null
  return OAUTH_SCOPES.filter((s) => requested.includes(s))
}

export function isKnownScope(value: string): value is ApiKeyScope {
  return (OAUTH_SCOPES as readonly string[]).includes(value)
}
