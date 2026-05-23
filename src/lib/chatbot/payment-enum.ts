import type { SupabaseClient } from '@supabase/supabase-js';

interface PaymentRow {
  id: string;
  kind: string;
  name: string;
  instructions: string | null;
  details: Record<string, string | undefined>;
}

/**
 * Build a closed-world prompt block listing the user's enabled payment
 * methods. Always injected when there are any enabled methods so the LLM
 * can answer "how do I pay?" without retrieval recall risk.
 *
 * If paymentMethodIds is non-empty, filter to that set (the active page's
 * payment_method_ids). If null, return all enabled methods for the user.
 */
export async function paymentEnumBlock(
  client: SupabaseClient,
  userId: string,
  activePageTitle: string | null,
  paymentMethodIds: string[] | null,
): Promise<string> {
  let query = client
    .from('payment_methods')
    .select('id, kind, name, instructions, details')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (paymentMethodIds && paymentMethodIds.length > 0) {
    query = query.in('id', paymentMethodIds);
  }

  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`paymentEnumBlock: ${error.message}`);
  const methods = (data ?? []) as PaymentRow[];
  if (methods.length === 0) return '';

  const header = activePageTitle
    ? `Available Payment Methods (scoped to ${activePageTitle}):`
    : 'Available Payment Methods:';

  const lines = methods.map((m) => {
    const d = m.details ?? {};
    const bits: string[] = [];
    if (d.account_number) bits.push(`Account ${d.account_number}`);
    if (d.account_name) bits.push(`name ${d.account_name}`);
    if (d.bank_name) bits.push(`bank ${d.bank_name}`);
    const detail = bits.length > 0 ? `: ${bits.join(', ')}` : '';
    const inst = m.instructions?.trim() ? ` — ${m.instructions.trim()}` : '';
    return `- ${m.name}${detail}${inst}`;
  });

  return [header, ...lines].join('\n');
}
