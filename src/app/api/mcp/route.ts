import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBearer } from '@/lib/api-keys/resolve'
import { resolveMcpPrincipal } from '@/lib/mcp/auth'
import { publicOrigin, protectedResourceMetadataUrl } from '@/lib/oauth/origin'
import { CORS_HEADERS, preflightResponse } from '@/lib/oauth/http'
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
    { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...headers } },
  )
}

// A 401 carries the RFC 9728 pointer so an MCP client can discover the OAuth
// flow on its own: fetch the resource metadata, find the authorization server,
// register, and send the operator to /oauth/authorize.
function unauthorized(req: Request): Response {
  const metadataUrl = protectedResourceMetadataUrl(publicOrigin(req))
  return jsonRpcError(401, -32001, 'Sign in required. Connect this MCP server through OAuth or use an API key.', {
    'www-authenticate': `Bearer realm="whatstage-mcp", resource_metadata="${metadataUrl}"`,
  })
}

/**
 * Streamable HTTP MCP endpoint. Stateless: each POST authenticates the bearer
 * (OAuth access token or API key), builds a server bound to that tenant,
 * handles the one request, and discards it. No sessions, so GET (SSE stream)
 * and DELETE are not offered.
 */
export async function POST(req: Request): Promise<Response> {
  const admin = createAdminClient()
  let principal
  try {
    principal = await resolveMcpPrincipal(admin, parseBearer(req.headers.get('authorization')))
  } catch (e) {
    console.error('[mcp] bearer lookup failed', e)
    return jsonRpcError(500, -32603, 'Could not verify credentials.')
  }
  if (!principal) return unauthorized(req)
  if (!checkRateLimit(`mcp:${principal.principalId}`, Date.now(), REQUESTS_PER_MINUTE)) {
    return jsonRpcError(429, -32000, 'Rate limit exceeded. Try again in a minute.', { 'retry-after': '60' })
  }

  const server = createWhatStageMcpServer({ admin, userId: principal.userId, scopes: principal.scopes })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(req, {
      authInfo: { token: 'redacted', clientId: principal.principalId, scopes: principal.scopes },
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

export function OPTIONS(): Response {
  return preflightResponse()
}

export function DELETE(): Response {
  return jsonRpcError(405, -32000, 'This MCP endpoint is stateless; nothing to delete.', { allow: 'POST' })
}
