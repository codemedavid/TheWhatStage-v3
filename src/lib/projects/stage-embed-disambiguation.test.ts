import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Repo root, relative to this file (src/lib/projects/).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// Every source file that embeds a project's stage through PostgREST. `projects`
// carries TWO foreign keys to `project_stages` — the plain `stage_id` FK and the
// composite `(workspace_id, stage_id)` FK added with workspaces — so a bare
// `project_stages(...)` embed is ambiguous and the API rejects it with PGRST201.
// Each embed must name the relationship: `project_stages!projects_stage_id_fkey`.
const EMBED_FILES = [
  'src/lib/agent/loadContext.ts',
  'src/lib/projects/active-project.ts',
  'src/app/(app)/dashboard/action-pages/_lib/queries.ts',
  'src/app/(app)/dashboard/projects/_lib/queries.ts',
] as const

// A table name immediately followed by `(` is a PostgREST embed. The
// disambiguated form is `project_stages!projects_stage_id_fkey(...)`, where the
// `(` follows `fkey`, not `project_stages` — so this pattern matches only the
// ambiguous bare embeds. Table refs (`'project_stages'`) and type fields
// (`project_stages: {...}`) are followed by `'`/`:`, not `(`, and never match.
const AMBIGUOUS_EMBED = /project_stages\(/g

describe('projects→project_stages embeds are FK-disambiguated', () => {
  for (const file of EMBED_FILES) {
    it(`${file} has no ambiguous project_stages embed`, () => {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      const matches = source.match(AMBIGUOUS_EMBED) ?? []
      expect(
        matches,
        `bare project_stages(...) embed in ${file} — name the FK: project_stages!projects_stage_id_fkey(...)`,
      ).toEqual([])
    })
  }
})
