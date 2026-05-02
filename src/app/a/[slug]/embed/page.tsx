import { notFound } from 'next/navigation'
import { loadPublicActionPage } from '../_lib/load'
import { ActionPageRenderer } from '../_components/Renderer'

export default async function EmbedActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const result = await loadPublicActionPage(slug, sp)
  if (!result) notFound()
  const rawToken = typeof sp.t === 'string' ? sp.t : null

  return (
    <main className="min-h-screen bg-transparent p-4">
      <ActionPageRenderer
        page={result.page}
        claims={result.claims}
        rawToken={rawToken}
        variant="embed"
        products={result.products ?? []}
      />
    </main>
  )
}
