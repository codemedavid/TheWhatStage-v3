import { describe, expect, it, vi } from 'vitest';
import { syncPaymentMethodToKnowledge } from './sync';

describe('syncPaymentMethodToKnowledge', () => {
  it('enqueues an embed job for the given payment method', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const supabase = {
      from: vi.fn(),
    } as unknown as Parameters<typeof syncPaymentMethodToKnowledge>[0];

    await syncPaymentMethodToKnowledge(
      supabase,
      'user-1',
      'pm-1',
      { _enqueue: enqueue },
    );

    expect(enqueue).toHaveBeenCalledWith(supabase, {
      kind: 'payment_method',
      sourceId: 'pm-1',
      userId: 'user-1',
    });
  });
});
