import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBearer, resolveApiKey } from '@/lib/api-keys/resolve'
import { checkRateLimit } from '@/lib/action-pages/upload-guard'
import { createWhatStageMcpServer } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-key request budget. Tool calls are cheap DB reads for the most part; the
// cap exists to blunt a leaked key, not to meter normal use.
const REQUESTS_PER_MINUTE = 120

function jsonRpcError(status: number, code: number, message: string, headers?: HeadersInit): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  )
}

/**
 * Streamable HTTP MCP endpoint. Stateless: each POST authenticates the API
 * key, builds a server bound to that tenant, handles the one request, and
 * discards it. No sessions, so GET (SSE stream) and DELETE are not offered.
 */
export async function POST(req: Request): Promise<Response> {
  const admin = createAdminClient()
  let key
  try {
    key = await resolveApiKey(admin, parseBearer(req.headers.get('authorization')))
  } catch (e) {
    console.error('[mcp] api key lookup failed', e)
    return jsonRpcError(500, -32603, 'Could not verify API key.')
  }
  if (!key) {
    return jsonRpcError(401, -32001, 'Invalid or missing API key.', {
      'www-authenticate': 'Bearer realm="whatstage-mcp"',
    })
  }
  if (!checkRateLimit(`mcp:${key.keyId}`, Date.now(), REQUESTS_PER_MINUTE)) {
    return jsonRpcError(429, -32000, 'Rate limit exceeded. Try again in a minute.', { 'retry-after': '60' })
  }

  const server = createWhatStageMcpServer({ admin, userId: key.userId, scopes: key.scopes })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(req, {
      authInfo: { token: 'redacted', clientId: key.keyId, scopes: key.scopes },
    })
  } catch (e) {
    console.error('[mcp] request failed', e)
    return jsonRpcError(500, -32603, 'Internal error.')
  } finally {
    // Close after the response is produced; with JSON responses the body is
    // already materialised, so this does not cut a stream short.
    void transport.close().catch(() => undefined)
  }
}

export function GET(): Response {
  return jsonRpcError(405, -32000, 'This MCP endpoint is stateless; use POST.', { allow: 'POST' })
}

export function DELETE(): Response {
  return jsonRpcError(405, -32000, 'This MCP endpoint is stateless; nothing to delete.', { allow: 'POST' })
}
