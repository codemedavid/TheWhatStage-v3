import { NewCampaignForm } from '../_components/NewCampaignForm'
import '../funnels.css'

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const initialError = error ? (detail ? `${error} — ${detail}` : error) : null
  return <NewCampaignForm initialError={initialError} />
}
