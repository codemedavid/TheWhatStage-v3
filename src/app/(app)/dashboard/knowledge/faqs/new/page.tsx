import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchCategories } from '../../_lib/queries'
import { FaqForm } from '../_components/FaqForm'

export default async function NewFaqPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const categories = await fetchCategories(supabase, user.id)
  return <FaqForm categories={categories} />
}
