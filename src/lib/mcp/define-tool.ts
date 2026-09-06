import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ZodRawShape } from 'zod'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'
import { describeToolError, errorResult, requireScope, type McpContext } from './context'

interface ToolSpec<Shape extends ZodRawShape> {
  name: string
  title: string
  description: string
  /** Required API-key scope. Read tools omit it (every key can read). */
  scope?: ApiKeyScope
  input: Shape
  annotations?: ToolAnnotations
}

type InferShape<Shape extends ZodRawShape> = {
  [K in keyof Shape]: Shape[K] extends { _output: infer O } ? O : never
}

/**
 * Register a tool with scope enforcement and uniform error handling. Handlers
 * throw freely (McpToolError for expected failures); the wrapper returns an
 * `isError` result so the model sees a message instead of a protocol error.
 */
export function defineTool<Shape extends ZodRawShape>(
  server: McpServer,
  ctx: McpContext,
  spec: ToolSpec<Shape>,
  handler: (args: InferShape<Shape>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: spec.annotations,
    },
    (async (args: InferShape<Shape>) => {
      try {
        if (spec.scope) requireScope(ctx, spec.scope)
        return await handler(args)
      } catch (e) {
        console.error(`[mcp] ${spec.name} failed`, e)
        return errorResult(describeToolError(e))
      }
    }) as never,
  )
}
