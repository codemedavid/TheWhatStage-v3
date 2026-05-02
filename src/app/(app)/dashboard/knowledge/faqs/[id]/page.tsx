import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchCategories, fetchFaq } from '../../_lib/queries'
import { FaqForm } from '../_components/FaqForm'

export default async function EditFaqPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [faq, categories] = await Promise.all([
    fetchFaq(supabase, user.id, id),
    fetchCategories(supabase, user.id),
  ])
  if (!faq) notFound()

  return <FaqForm faq={faq} categories={categories} />
}
