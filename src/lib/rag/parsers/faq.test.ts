import { describe, it, expect } from 'vitest';
import { parseFaq } from './faq';

describe('parseFaq', () => {
  it('produces atomic markdown with question as H1', () => {
    const r = parseFaq({ question: 'Refund window?', answer: 'Within 30 days.' });
    expect(r.kind).toBe('faq');
    expect(r.atomic).toBe(true);
    expect(r.title).toBe('Refund window?');
    expect(r.markdown).toBe('# Refund window?\n\nWithin 30 days.');
  });

  it('handles empty answer', () => {
    const r = parseFaq({ question: 'Q', answer: '' });
    expect(r.markdown).toBe('# Q\n\n');
  });

  it('normalizes CRLF', () => {
    const r = parseFaq({ question: 'Q', answer: 'a\r\nb' });
    expect(r.markdown).toBe('# Q\n\na\nb');
  });

  it('trims whitespace', () => {
    const r = parseFaq({ question: '  Q  ', answer: '  A  ' });
    expect(r.title).toBe('Q');
    expect(r.markdown).toBe('# Q\n\nA');
  });
});
