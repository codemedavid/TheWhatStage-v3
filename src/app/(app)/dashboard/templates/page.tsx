import { TemplatesClient } from './_components/TemplatesClient'
import { loadTemplates, listCategories } from './actions'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const [initialTemplates, initialCategories] = await Promise.all([
    loadTemplates(),
    listCategories(),
  ])
  return (
    <TemplatesClient
      initialTemplates={initialTemplates}
      initialCategories={initialCategories}
    />
  )
}
