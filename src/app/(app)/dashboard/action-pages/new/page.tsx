import { NewActionPageWizard } from '../_components/NewActionPageWizard'

export default async function NewActionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const initialError = error ? (detail ? `${error} — ${detail}` : error) : null

  return <NewActionPageWizard initialError={initialError} />
}
