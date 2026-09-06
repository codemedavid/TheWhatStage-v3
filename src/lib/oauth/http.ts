// Small HTTP helpers shared by the OAuth route handlers. The discovery, token
// and registration endpoints are called cross-origin by browser-based MCP
// clients (e.g. the MCP Inspector), so they answer CORS preflights openly;
// nothing on them is cookie-authenticated.
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
}

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
      ...CORS_HEADERS,
      ...headers,
    },
  })
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'access_denied'
  | 'server_error'

export interface OAuthErrorBody {
  error: OAuthErrorCode
  error_description?: string
}

export function oauthError(error: OAuthErrorCode, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description } satisfies OAuthErrorBody, status)
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// Best-effort client address for rate limiting behind Vercel's proxy.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

// Token and registration bodies may arrive as JSON or form-encoded.
export async function readBodyParams(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? ''
  const text = await req.text()
  if (!text) return {}
  if (type.includes('application/json')) {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  }
  return Object.fromEntries(new URLSearchParams(text))
}
