import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { fetchActionPages } from './_lib/queries'
import { ActionPagesList } from './_components/ActionPagesList'

export default async function ActionPagesIndex() {
  return (
    <Suspense fallback={<ListFallback />}>
      <List />
    </Suspense>
  )
}

function ListFallback() {
  return (
    <div data-actions-list>
      <div className="apl-wrap">
        <div className="apl-empty">Loading…</div>
      </div>
    </div>
  )
}

async function List() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const pages = await fetchActionPages(supabase, user.id)
  return <ActionPagesList pages={pages} />
}
