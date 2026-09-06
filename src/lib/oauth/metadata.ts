import type { OAuthMetadata, OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { OAUTH_SCOPES } from './scopes'
import { mcpResourceUrl } from './origin'

// RFC 8414 discovery document. Public clients with PKCE are the norm for MCP
// (claude.ai, Claude Desktop, Cursor); confidential clients are also allowed
// via client_secret_post so pre-registered integrations can use a secret.
export function authorizationServerMetadata(origin: string): OAuthMetadata {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: `${origin}/dashboard/settings/api-keys`,
  }
}

// RFC 9728 document a client fetches after a 401 from /api/mcp.
export function protectedResourceMetadata(origin: string): OAuthProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'WhatStage MCP',
    resource_documentation: `${origin}/dashboard/settings/api-keys`,
  }
}
