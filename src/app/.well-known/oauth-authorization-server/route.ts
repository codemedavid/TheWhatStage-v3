import { authorizationServerMetadata } from '@/lib/oauth/metadata'
import { publicOrigin } from '@/lib/oauth/origin'
import { jsonResponse, preflightResponse } from '@/lib/oauth/http'

export const dynamic = 'force-dynamic'

// RFC 8414 discovery for the MCP OAuth flow.
export function GET(req: Request): Response {
  return jsonResponse(authorizationServerMetadata(publicOrigin(req)), 200, { 'cache-control': 'public, max-age=300' })
}

export function OPTIONS(): Response {
  return preflightResponse()
}
