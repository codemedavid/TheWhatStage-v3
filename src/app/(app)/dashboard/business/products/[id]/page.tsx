import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProductEditor } from '../../_components/ProductEditor'
import { fetchProduct } from '../../_lib/queries'

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const product = await fetchProduct(supabase, user.id, id)
  if (!product) notFound()
  return <ProductEditor product={product} />
}
