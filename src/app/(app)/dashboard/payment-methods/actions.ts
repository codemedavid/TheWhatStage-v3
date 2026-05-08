'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  type PaymentMethod,
  type PaymentMethodInput,
  type PaymentMethodKind,
} from '@/lib/payment-methods/types'

const ALLOWED_KINDS: PaymentMethodKind[] = ['gcash', 'bank_transfer', 'other']

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function loadPaymentMethods(): Promise<PaymentMethod[]> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadPaymentMethods: ${error.message}`)
  return (data ?? []) as PaymentMethod[]
}

function normalizeInput(input: PaymentMethodInput) {
  if (!ALLOWED_KINDS.includes(input.kind)) {
    throw new Error('Invalid payment method kind.')
  }
  const name = input.name.trim()
  if (!name) throw new Error('Name is required.')
  if (name.length > 120) throw new Error('Name is too long (max 120).')
  const instructions = input.instructions?.trim() || null
  if (instructions && instructions.length > 2000) {
    throw new Error('Instructions are too long (max 2000).')
  }

  // Strip empty detail values so we don't save "".
  const details: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.details ?? {})) {
    if (typeof v === 'string' && v.trim().length > 0) details[k] = v.trim()
  }

  return {
    kind: input.kind,
    name,
    instructions,
    details,
    enabled: input.enabled !== false,
  }
}

export async function createPaymentMethod(
  input: PaymentMethodInput,
): Promise<string> {
  const { supabase, userId } = await requireUser()
  const row = normalizeInput(input)

  const { count } = await supabase
    .from('payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const position = count ?? 0

  const { data, error } = await supabase
    .from('payment_methods')
    .insert({ ...row, user_id: userId, position })
    .select('id')
    .single<{ id: string }>()
  if (error) throw new Error(`createPaymentMethod: ${error.message}`)
  revalidatePath('/dashboard/payment-methods')
  return data.id
}

export async function updatePaymentMethod(
  id: string,
  input: PaymentMethodInput,
): Promise<void> {
  const { supabase, userId } = await requireUser()
  const row = normalizeInput(input)
  const { error } = await supabase
    .from('payment_methods')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updatePaymentMethod: ${error.message}`)
  revalidatePath('/dashboard/payment-methods')
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('payment_methods')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deletePaymentMethod: ${error.message}`)
  revalidatePath('/dashboard/payment-methods')
}

export async function setPaymentMethodEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('payment_methods')
    .update({ enabled })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`setPaymentMethodEnabled: ${error.message}`)
  revalidatePath('/dashboard/payment-methods')
}
