import type { ActionPageOption, ActionPageRow, PipelineStageOption } from '../_lib/queries'

/**
 * Contract every kind editor must satisfy.
 *
 * The editor is rendered INSIDE the action-page form on
 * /dashboard/action-pages/[id]. It must include a hidden input named
 * `config` whose value is the JSON-serialized kind-specific config blob.
 * The updateActionPage server action reads that field and persists it to
 * `action_pages.config`.
 *
 * See _kinds/form/Editor.tsx (after the Form PR lands) for a reference
 * implementation.
 */
export interface KindEditorProps {
  page: ActionPageRow
  stages?: PipelineStageOption[]
  actionPages?: ActionPageOption[]
}
