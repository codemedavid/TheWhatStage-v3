import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'

// Everything a tool handler needs. `admin` is the service-role client, so every
// query MUST be scoped by `userId` — the MCP server never relies on RLS.
export interface McpContext {
  admin: SupabaseClient
  userId: string
  scopes: ApiKeyScope[]
}

// Thrown by tools for expected, user-explainable failures (not found, not
// permitted, policy blocked). The tool wrapper turns it into an isError result.
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

export function requireScope(ctx: McpContext, scope: ApiKeyScope): void {
  if (!ctx.scopes.includes(scope)) {
    throw new McpToolError(`This API key does not have the "${scope}" scope.`)
  }
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

// Map any thrown value to a plain message the model can act on. Stack traces
// and PostgREST internals never reach the client.
export function describeToolError(e: unknown): string {
  if (e instanceof McpToolError) return e.message
  if (e instanceof Error && e.message.trim()) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return 'Unexpected error.'
}
