import { TemplatesClient } from './_components/TemplatesClient'
import { loadTemplates } from './actions'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const templates = await loadTemplates()
  return <TemplatesClient initialTemplates={templates} />
}
