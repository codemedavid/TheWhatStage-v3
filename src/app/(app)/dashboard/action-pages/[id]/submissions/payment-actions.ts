'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  verifyPayment as verifyPaymentDb,
  rejectPayment as rejectPaymentDb,
} from '@/lib/order-payments/server'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function verifyPayment(orderPaymentId: string, actionPageId: string) {
  const { supabase, userId } = await requireUser()
  await verifyPaymentDb(supabase, orderPaymentId, userId, userId)
  revalidatePath(`/dashboard/action-pages/${actionPageId}/submissions`)
}

export async function rejectPayment(
  orderPaymentId: string,
  reason: string,
  actionPageId: string,
) {
  const { supabase, userId } = await requireUser()
  await rejectPaymentDb(supabase, orderPaymentId, userId, reason)
  revalidatePath(`/dashboard/action-pages/${actionPageId}/submissions`)
}
