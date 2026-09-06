// The public origin every OAuth URL is built from. NEXT_PUBLIC_APP_URL wins
// when it is a well-formed absolute URL; otherwise we trust the request's own
// host (Vercel sets x-forwarded-host/proto), which is what a client actually
// reached us on. Issuer, resource, and endpoint URLs must all agree, so every
// caller goes through this one helper.
export function publicOrigin(req: Request): string {
  const configured = parseAbsoluteOrigin(process.env.NEXT_PUBLIC_APP_URL)
  if (configured) return configured

  const forwardedHost = req.headers.get('x-forwarded-host')
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const url = new URL(req.url)
  const host = forwardedHost ?? url.host
  const proto = forwardedProto ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

function parseAbsoluteOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

export const MCP_PATH = '/api/mcp'

export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`
}
