import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchFieldDefs } from '../_lib/queries'
import { FieldDefManager } from '../_components/FieldDefManager'

export default async function FieldsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const defs = await fetchFieldDefs(supabase, user.id)
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Custom lead fields</h1>
      <FieldDefManager defs={defs} />
    </div>
  )
}
