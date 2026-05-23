import type { PaymentMethod } from './types';

export function buildPaymentMethodRagText(method: PaymentMethod): string {
  if (!method.enabled) return '';

  const lines: string[] = [];
  lines.push(`Payment method: ${method.name}`);
  lines.push(`Kind: ${method.kind}`);

  const d = method.details ?? {};
  if (d.bank_name) lines.push(`Bank: ${d.bank_name}`);
  if (d.account_name) lines.push(`Account name: ${d.account_name}`);
  if (d.account_number) lines.push(`Account number: ${d.account_number}`);
  if (d.branch) lines.push(`Branch: ${d.branch}`);

  if (method.instructions && method.instructions.trim()) {
    lines.push(`Instructions: ${method.instructions.trim()}`);
  }

  if (d.qr_image_url) {
    lines.push(`QR image: ${d.qr_image_url}`);
  }

  return lines.join('\n');
}
