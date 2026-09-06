import { protectedResourceMetadata } from '@/lib/oauth/metadata'
import { publicOrigin } from '@/lib/oauth/origin'
import { jsonResponse, preflightResponse } from '@/lib/oauth/http'

export const dynamic = 'force-dynamic'

// RFC 9728 path-based document for the /api/mcp resource (the one the 401 points at).
export function GET(req: Request): Response {
  return jsonResponse(protectedResourceMetadata(publicOrigin(req)), 200, { 'cache-control': 'public, max-age=300' })
}

export function OPTIONS(): Response {
  return preflightResponse()
}
