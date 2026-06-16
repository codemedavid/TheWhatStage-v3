import { TemplatesClient } from './_components/TemplatesClient'
import type { StatusFilter } from './_components/StatusSpine'
import { loadTemplates, listCategories } from './actions'

export const dynamic = 'force-dynamic'

const VALID_STATUS: StatusFilter[] = ['all', 'draft', 'pending', 'approved', 'rejected', 'disabled']

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [initialTemplates, initialCategories] = await Promise.all([
    loadTemplates(),
    listCategories(),
  ])

  const sp = await searchParams
  const statusRaw = typeof sp.status === 'string' ? sp.status : undefined
  const initialStatus = statusRaw && VALID_STATUS.includes(statusRaw as StatusFilter)
    ? (statusRaw as StatusFilter)
    : undefined
  const initialSelectedId = typeof sp.selected === 'string' ? sp.selected : null

  return (
    <TemplatesClient
      initialTemplates={initialTemplates}
      initialCategories={initialCategories}
      initialStatus={initialStatus}
      initialSelectedId={initialSelectedId}
    />
  )
}
