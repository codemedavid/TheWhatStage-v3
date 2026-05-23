import { describe, expect, it } from 'vitest';
import { buildPaymentMethodRagText } from './rag-text';
import type { PaymentMethod } from './types';

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'pm-1',
    user_id: 'u-1',
    kind: 'gcash',
    name: 'GCash · Main',
    instructions: 'Send exact amount, then upload your receipt.',
    details: {
      account_name: 'Juan Dela Cruz',
      account_number: '0917-123-4567',
      qr_image_url: 'https://example.com/qr.png',
    },
    enabled: true,
    position: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildPaymentMethodRagText', () => {
  it('emits a stable text shape for a gcash method', () => {
    const out = buildPaymentMethodRagText(makeMethod());
    expect(out).toContain('Payment method: GCash · Main');
    expect(out).toContain('Kind: gcash');
    expect(out).toContain('Account name: Juan Dela Cruz');
    expect(out).toContain('Account number: 0917-123-4567');
    expect(out).toContain('Instructions: Send exact amount, then upload your receipt.');
    expect(out).toContain('QR image:');
  });

  it('handles bank_transfer fields', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({
        kind: 'bank_transfer',
        name: 'BPI Savings',
        details: {
          bank_name: 'BPI',
          account_name: 'Juan Dela Cruz',
          account_number: '1234-5678-90',
          branch: 'Makati',
        },
      }),
    );
    expect(out).toContain('Kind: bank_transfer');
    expect(out).toContain('Bank: BPI');
    expect(out).toContain('Branch: Makati');
    expect(out).toContain('Account number: 1234-5678-90');
  });

  it('omits empty optional fields cleanly', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({ instructions: null, details: { account_number: '0917-000-0000' } }),
    );
    expect(out).not.toContain('Instructions:');
    expect(out).not.toContain('Account name:');
    expect(out).toContain('Account number: 0917-000-0000');
  });

  it('skips the QR line when no qr_image_url is set', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({ details: { account_number: '0917-000-0000' } }),
    );
    expect(out).not.toContain('QR image:');
  });

  it('returns an empty string when the method is disabled', () => {
    const out = buildPaymentMethodRagText(makeMethod({ enabled: false }));
    expect(out).toBe('');
  });
});
