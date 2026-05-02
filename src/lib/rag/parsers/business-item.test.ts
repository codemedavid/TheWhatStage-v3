import { describe, expect, it } from 'vitest';
import { parse } from './index';

describe('parse business_item', () => {
  it('returns an atomic business item source with normalized markdown', () => {
    const parsed = parse({
      kind: 'business_item',
      title: 'Starter Kit',
      ragText: '  First line\r\nSecond line  ',
    });

    expect(parsed.kind).toBe('business_item');
    expect(parsed.title).toBe('Starter Kit');
    expect(parsed.markdown).toBe('# Starter Kit\n\nFirst line\nSecond line');
    expect(parsed.atomic).toBe(true);
  });
});
