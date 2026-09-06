import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './context'
import { registerLeadTools } from './tools/leads'
import { registerConversationTools } from './tools/conversation'
import { registerMessagingTools } from './tools/messaging'
import { registerProjectTools } from './tools/projects'

export const MCP_SERVER_NAME = 'whatstage'
export const MCP_SERVER_VERSION = '1.0.0'

const INSTRUCTIONS = `WhatStage is a Messenger CRM. Leads are customers who chatted with the business's Facebook Page; projects are deals/jobs attached to a lead and tracked on kanban boards (workspaces with stages).
Typical flow: search_leads → get_lead / get_conversation → get_message_attachment for any image or file you need to see → send_message to reply as the human operator → create_project / move_project to track the deal.
Sending a message pauses the AI chatbot on that thread for the business's takeover window. Meta only allows operator replies within 7 days of the customer's last message.`

// One server per request: the route is stateless and the tools close over the
// authenticated tenant, so nothing is shared between API keys.
export function createWhatStageMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  registerLeadTools(server, ctx)
  registerConversationTools(server, ctx)
  registerMessagingTools(server, ctx)
  registerProjectTools(server, ctx)
  return server
}
