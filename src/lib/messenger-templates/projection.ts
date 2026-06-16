// Shared projection for an "Agent-usable" template — the approved templates the
// AI Follow-Up Agent can send. Defining the SELECT + row mapping once keeps
// agent/page.tsx and any other consumer from drifting on the shape of "what the
// Agent can use".

import type { TemplateButton, TemplateCategory } from './types'

export const AGENT_TEMPLATE_SELECT =
  'id, display_name, name, language, body_text, variable_count, buttons, ' +
  'messenger_template_categories(category:template_categories(id, slug, label, is_system, sort_order))'

export interface AgentTemplate {
  id: string
  display_name: string
  name: string
  language: string
  body_text: string
  variable_count: number
  buttons: TemplateButton[]
  categories: TemplateCategory[]
}

export function mapAgentTemplate(row: Record<string, unknown>): AgentTemplate {
  const joins =
    (row.messenger_template_categories as Array<{ category: TemplateCategory | null } | null> | null) ?? []
  return {
    id: row.id as string,
    display_name: row.display_name as string,
    name: row.name as string,
    language: row.language as string,
    body_text: row.body_text as string,
    variable_count: row.variable_count as number,
    buttons: (row.buttons as TemplateButton[]) ?? [],
    categories: joins
      .map((j) => j?.category)
      .filter((c): c is TemplateCategory => !!c),
  }
}
