import { describe, expect, it, vi } from 'vitest'

// The crypto module reads FB_TOKEN_ENCRYPTION_KEY at import time.
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (v: string) => v }))
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createWhatStageMcpServer } from './server'
import type { McpContext } from './context'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'

// Protocol-level smoke: a real MCP client talks to the server over an
// in-memory transport. The admin client is a stub that returns nothing, so
// only registration, scope gating, and error shaping are exercised here.
function stubAdmin() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'lt', 'or', 'order', 'limit', 'insert', 'update']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.single = async () => ({ data: null, error: null })
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  return { from: () => chain, storage: { from: () => chain } } as never
}

async function connect(scopes: ApiKeyScope[]) {
  const ctx: McpContext = { admin: stubAdmin(), userId: 'u1', scopes }
  const server = createWhatStageMcpServer(ctx)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

const EXPECTED_TOOLS = [
  'search_leads', 'get_lead', 'get_lead_timeline', 'list_lead_submissions',
  'get_conversation', 'get_message_attachment',
  'send_message', 'list_action_pages', 'send_action_page',
  'list_workspaces', 'list_project_stages', 'list_projects', 'get_project', 'list_lead_projects',
  'create_project', 'update_project', 'move_project', 'archive_project', 'unarchive_project',
  'create_workspace', 'create_project_stage',
]

describe('WhatStage MCP server', () => {
  it('lists every tool with a description', async () => {
    const client = await connect(['read', 'send', 'projects'])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort())
    for (const t of tools) expect(t.description?.length ?? 0).toBeGreaterThan(20)
  })

  it('refuses write tools when the key lacks the scope, as a tool error not a protocol error', async () => {
    const client = await connect(['read'])
    const result = await client.callTool({
      name: 'send_message',
      arguments: { lead_id: '11111111-1111-4111-8111-111111111111', text: 'hi' },
    })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0].text).toContain('"send" scope')
  })

  it('turns a not-found into a readable tool error', async () => {
    const client = await connect(['read'])
    const result = await client.callTool({
      name: 'get_lead',
      arguments: { lead_id: '11111111-1111-4111-8111-111111111111' },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Lead not found')
  })

  it('validates arguments before the handler runs', async () => {
    const client = await connect(['read'])
    const result = await client.callTool({ name: 'get_lead', arguments: { lead_id: 'not-a-uuid' } })
    expect(result.isError).toBe(true)
  })
})
