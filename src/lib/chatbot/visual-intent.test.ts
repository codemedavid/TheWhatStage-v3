// src/lib/chatbot/visual-intent.test.ts
import { describe, expect, it } from 'vitest';
import { hasVisualIntent } from './visual-intent';

describe('hasVisualIntent', () => {
  it.each([
    ['show me the X10', true],
    ['can you send a photo', true],
    ['any pictures?', true],
    ['what does it look like', true],
    ['I want to see it', true],
    ['pakita mo nga', true],
    ['may litrato ba?', true],
    ['ipakita mo sa akin', true],
  ])('returns true for %p', (msg, expected) => {
    expect(hasVisualIntent(msg)).toBe(expected);
  });

  it.each([
    ['what is the price', false],
    ['how do I pay', false],
    ['is it in stock', false],
    ['', false],
    ['I love this product', false],
  ])('returns false for %p', (msg, expected) => {
    expect(hasVisualIntent(msg)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(hasVisualIntent('SHOW ME PLEASE')).toBe(true);
  });
});
