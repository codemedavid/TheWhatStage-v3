// PostgREST embed token for a project's stage.
//
// `projects` carries TWO foreign keys to `project_stages`: the plain
// `projects_stage_id_fkey` (stage_id → id) and the composite
// `projects_workspace_stage_fk` ((workspace_id, stage_id) → (workspace_id, id))
// added with workspaces to keep a card's workspace aligned with its stage. With
// two relationships, a bare `project_stages(...)` embed is ambiguous and the API
// rejects the whole query with PGRST201. Naming the simple `stage_id`
// relationship resolves to the same stage and matches pre-workspaces behavior.
//
// Use as: `${STAGE_EMBED}(name, kind)` inside a `.from('projects').select(...)`.
export const STAGE_EMBED = 'project_stages!projects_stage_id_fkey'
