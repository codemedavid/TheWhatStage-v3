import { getSession } from '@/lib/auth/get-session'
import { getViewer } from '@/lib/university/access'
import { getCatalog } from '@/lib/university/data'
import type { CatalogData } from '@/lib/university/data'
import { CatalogClient } from './_components/CatalogClient'

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

export default async function UniversityCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const session = await getSession()
  const viewer = getViewer(session)

  let data: CatalogData = { courses: [], categories: [], continueItems: [] }
  let loadError = false
  try {
    data = await getCatalog(session)
  } catch {
    loadError = true
  }

  const initialFilters = {
    category: firstParam(sp.category),
    access: firstParam(sp.access),
    q: firstParam(sp.q),
  }

  return (
    <CatalogClient
      courses={data.courses}
      categories={data.categories}
      continueItems={data.continueItems}
      viewer={viewer}
      initialFilters={initialFilters}
      loadError={loadError}
    />
  )
}
