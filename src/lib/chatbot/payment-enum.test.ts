import { describe, expect, it, vi } from 'vitest';
import { paymentEnumBlock } from './payment-enum';

function makeFakeSupabase(rows: Record<string, unknown>[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  } as unknown as Parameters<typeof paymentEnumBlock>[0];
}

describe('paymentEnumBlock', () => {
  it('returns empty string when no enabled methods exist', async () => {
    const supabase = makeFakeSupabase([]);
    const out = await paymentEnumBlock(supabase, 'user-1', null, null);
    expect(out).toBe('');
  });

  it('lists enabled methods (global, no active page)', async () => {
    const supabase = makeFakeSupabase([
      { id: 'pm-1', kind: 'gcash', name: 'GCash · Main',
        instructions: 'Send exact amount.',
        details: { account_number: '0917-123-4567', account_name: 'Juan' } },
      { id: 'pm-2', kind: 'bank_transfer', name: 'BPI Savings',
        instructions: null,
        details: { account_number: '1234-5678-90', bank_name: 'BPI' } },
    ]);
    const out = await paymentEnumBlock(supabase, 'user-1', null, null);
    expect(out).toContain('Available Payment Methods');
    expect(out).toContain('GCash · Main');
    expect(out).toContain('0917-123-4567');
    expect(out).toContain('BPI Savings');
  });

  it('includes the scoping note when an active page is provided', async () => {
    const supabase = makeFakeSupabase([
      { id: 'pm-1', kind: 'gcash', name: 'GCash · Main',
        instructions: null, details: { account_number: '0917-000-0000' } },
    ]);
    const out = await paymentEnumBlock(supabase, 'user-1', 'Summer Catalog', ['pm-1']);
    expect(out).toContain('Available Payment Methods (scoped to Summer Catalog)');
  });
});
