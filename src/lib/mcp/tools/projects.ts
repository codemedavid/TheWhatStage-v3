import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  fetchBoardProjects,
  fetchProjectById,
  fetchProjectStages,
  fetchProjectsByLead,
  type ProjectCardRow,
} from '@/app/(app)/dashboard/projects/_lib/queries'
import {
  fetchWorkspaces,
  resolveDefaultStageId,
  resolveDestinationWorkspaceId,
} from '@/app/(app)/dashboard/projects/_lib/workspaces'
import {
  archiveProjectFor,
  createProjectFor,
  createProjectStageFor,
  createWorkspaceFor,
  moveProjectFor,
  nextStagePosition,
  unarchiveProjectFor,
  updateProjectFor,
} from '@/app/(app)/dashboard/projects/_lib/mutations'
import { defineTool } from '../define-tool'
import { jsonResult, McpToolError, type McpContext } from '../context'

const PROJECT_LIST_MAX = 200

// Card shape returned to the model: drop internal ordering/tenant fields.
function presentProject(p: ProjectCardRow) {
  const { user_id: _u, position: _p, ...rest } = p
  void _u; void _p
  return rest
}

async function loadProjectOrThrow(ctx: McpContext, projectId: string): Promise<ProjectCardRow> {
  const project = await fetchProjectById(ctx.admin, ctx.userId, projectId)
  if (!project) throw new McpToolError('Project not found.')
  return project
}

export function registerProjectTools(server: McpServer, ctx: McpContext): void {
  defineTool(server, ctx, {
    name: 'list_workspaces',
    title: 'List project workspaces',
    description: 'All project workspaces (separate kanban boards) for this business. Each has its own stages. Read-only.',
    input: {},
    annotations: { readOnlyHint: true },
  }, async () => jsonResult({ workspaces: await fetchWorkspaces(ctx.admin, ctx.userId) }))

  defineTool(server, ctx, {
    name: 'list_project_stages',
    title: 'List project stages',
    description: 'Stages (kanban columns) of one workspace in board order, with kind open/won/lost and which one is the default landing stage. Read-only.',
    input: { workspace_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ workspace_id }) => jsonResult({ stages: await fetchProjectStages(ctx.admin, ctx.userId, workspace_id) }))

  defineTool(server, ctx, {
    name: 'list_projects',
    title: 'List projects',
    description:
      'Projects (deals/jobs) in a workspace with their lead, stage, value, and unread-message counts. Omit workspace_id for the default workspace. Optional text search over title/description. Archived projects are excluded unless include_archived is true. Read-only.',
    input: {
      workspace_id: z.string().uuid().optional(),
      stage_id: z.string().uuid().optional(),
      query: z.string().trim().max(120).optional(),
      include_archived: z.boolean().default(false),
      limit: z.number().int().min(1).max(PROJECT_LIST_MAX).default(100),
    },
    annotations: { readOnlyHint: true },
  }, async ({ workspace_id, stage_id, query, include_archived, limit }) => {
    const workspaceId = await resolveDestinationWorkspaceId(ctx.admin, ctx.userId, workspace_id)
    const rows = await fetchBoardProjects(ctx.admin, ctx.userId, workspaceId, { q: query })
    const projects = rows
      .filter((p) => (include_archived || !p.is_archived) && (!stage_id || p.stage_id === stage_id))
      .slice(0, limit)
      .map(presentProject)
    return jsonResult({ workspace_id: workspaceId, projects })
  })

  defineTool(server, ctx, {
    name: 'get_project',
    title: 'Get project',
    description: 'One project with its lead contact details, stage, value, description, notes, and AI instructions. Read-only.',
    input: { project_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ project_id }) => jsonResult({ project: presentProject(await loadProjectOrThrow(ctx, project_id)) }))

  defineTool(server, ctx, {
    name: 'list_lead_projects',
    title: 'List projects for a lead',
    description: 'Every project (in any workspace) attached to a lead, most recently updated first. Read-only.',
    input: { lead_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ lead_id }) => {
    const rows = await fetchProjectsByLead(ctx.admin, ctx.userId, lead_id)
    return jsonResult({ projects: rows.map(presentProject) })
  })

  defineTool(server, ctx, {
    name: 'create_project',
    title: 'Create project',
    description:
      'Create a project (deal/job card) for a lead. Lands in the given stage, or the default stage of the given workspace, or the default stage of the default workspace. Side effects: the stage\'s follow-up sequence (if configured) starts for this lead, and the lead\'s unread counters reset. Currency defaults to the business default (3-letter code).',
    scope: 'projects',
    input: {
      lead_id: z.string().uuid(),
      title: z.string().trim().min(1).max(160),
      workspace_id: z.string().uuid().optional(),
      stage_id: z.string().uuid().optional().describe('Overrides workspace_id when given.'),
      description: z.string().max(4000).optional(),
      value: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      notes: z.string().max(4000).optional(),
      ai_instructions: z.string().max(4000).optional().describe('Guidance the chatbot follows when talking to this lead about this project.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ lead_id, title, workspace_id, stage_id, description, value, currency, notes, ai_instructions }) => {
    let stageId = stage_id
    if (!stageId) {
      const workspaceId = await resolveDestinationWorkspaceId(ctx.admin, ctx.userId, workspace_id)
      stageId = (await resolveDefaultStageId(ctx.admin, ctx.userId, workspaceId)) ?? undefined
      if (!stageId) throw new McpToolError('The workspace has no stages to receive a project.')
    }
    const id = await createProjectFor(ctx.admin, ctx.userId, {
      lead_id, stage_id: stageId, title, description, value, currency, notes, ai_instructions,
    })
    return jsonResult({ project: presentProject(await loadProjectOrThrow(ctx, id)) })
  })

  defineTool(server, ctx, {
    name: 'update_project',
    title: 'Update project',
    description: 'Edit a project\'s title, description, value, currency, notes, or AI instructions. Only the fields you pass change. Use move_project to change stage.',
    scope: 'projects',
    input: {
      project_id: z.string().uuid(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().max(4000).nullable().optional(),
      value: z.number().nonnegative().nullable().optional(),
      currency: z.string().length(3).optional(),
      notes: z.string().max(4000).nullable().optional(),
      ai_instructions: z.string().max(4000).nullable().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ project_id, ...fields }) => {
    await loadProjectOrThrow(ctx, project_id)
    await updateProjectFor(ctx.admin, ctx.userId, project_id, fields)
    return jsonResult({ project: presentProject(await loadProjectOrThrow(ctx, project_id)) })
  })

  defineTool(server, ctx, {
    name: 'move_project',
    title: 'Move project to stage',
    description:
      'Move a project to another stage in the same workspace (bottom of the column). Records a stage event, cancels the old stage\'s follow-up sequence, and starts the new stage\'s sequence if one is configured.',
    scope: 'projects',
    input: {
      project_id: z.string().uuid(),
      stage_id: z.string().uuid(),
      reason: z.string().max(500).optional().describe('Why it moved; stored on the stage event for the timeline.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ project_id, stage_id, reason }) => {
    const project = await loadProjectOrThrow(ctx, project_id)
    const stages = await fetchProjectStages(ctx.admin, ctx.userId, project.workspace_id)
    if (!stages.some((s) => s.id === stage_id)) {
      throw new McpToolError('Stage not found in this project\'s workspace. Use list_project_stages with the project\'s workspace_id.')
    }
    const position = await nextStagePosition(ctx.admin, ctx.userId, stage_id)
    const { stageChanged } = await moveProjectFor(ctx.admin, ctx.userId, project_id, stage_id, position, {
      source: 'user',
      reason: reason ?? null,
    })
    return jsonResult({ stage_changed: stageChanged, project: presentProject(await loadProjectOrThrow(ctx, project_id)) })
  })

  defineTool(server, ctx, {
    name: 'archive_project',
    title: 'Archive project',
    description: 'Hide a project from the board (soft archive) and cancel its in-flight follow-up sequence. Still counted in totals; reversible with unarchive_project.',
    scope: 'projects',
    input: { project_id: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ project_id }) => {
    await loadProjectOrThrow(ctx, project_id)
    await archiveProjectFor(ctx.admin, ctx.userId, project_id)
    return jsonResult({ ok: true })
  })

  defineTool(server, ctx, {
    name: 'unarchive_project',
    title: 'Unarchive project',
    description: 'Restore an archived project to the board. Does not restart its follow-up sequence.',
    scope: 'projects',
    input: { project_id: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ project_id }) => {
    await loadProjectOrThrow(ctx, project_id)
    await unarchiveProjectFor(ctx.admin, ctx.userId, project_id)
    return jsonResult({ ok: true })
  })

  defineTool(server, ctx, {
    name: 'create_workspace',
    title: 'Create workspace',
    description: 'Create a new project workspace (board) seeded with the standard starter stages.',
    scope: 'projects',
    input: {
      name: z.string().trim().min(1).max(60),
      description: z.string().max(500).optional(),
      color: z.string().max(32).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (input) => {
    const id = await createWorkspaceFor(ctx.admin, ctx.userId, input)
    return jsonResult({ workspace_id: id, stages: await fetchProjectStages(ctx.admin, ctx.userId, id) })
  })

  defineTool(server, ctx, {
    name: 'create_project_stage',
    title: 'Create project stage',
    description: 'Add a stage (kanban column) at the end of a workspace\'s board. kind is open (default), won, or lost.',
    scope: 'projects',
    input: {
      workspace_id: z.string().uuid(),
      name: z.string().trim().min(1).max(60),
      description: z.string().max(500).optional(),
      kind: z.enum(['open', 'won', 'lost']).optional(),
      color: z.string().max(32).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ workspace_id, ...input }) => {
    const id = await createProjectStageFor(ctx.admin, ctx.userId, workspace_id, input)
    return jsonResult({ stage_id: id })
  })
}
