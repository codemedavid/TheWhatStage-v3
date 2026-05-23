import type { ParsedSource } from '../types';
import { parseFaq } from './faq';
import { parseTiptap } from './tiptap';

export type ParseInput =
  | { kind: 'document'; title: string; contentJson: unknown; contentText?: string | null }
  | { kind: 'faq'; question: string; answer: string }
  | { kind: 'business_item'; title: string; ragText: string }
  | { kind: 'media_asset'; title: string; ragText: string }
  | { kind: 'payment_method'; title: string; ragText: string };

function parseTextSource(input: {
  kind: 'business_item' | 'media_asset' | 'payment_method';
  title: string;
  ragText: string;
}): ParsedSource {
  const title = input.title.trim() || 'Untitled';
  const body = (input.ragText ?? '').replace(/\r\n?/g, '\n').trim();
  const markdown = `# ${title}\n\n${body}`.trim();
  return { kind: input.kind, title, markdown, atomic: true };
}

function parseBusinessItem(input: { title: string; ragText: string }): ParsedSource {
  return parseTextSource({ ...input, kind: 'business_item' });
}

export function parse(input: ParseInput): ParsedSource {
  switch (input.kind) {
    case 'document':
      return parseTiptap(input);
    case 'faq':
      return parseFaq(input);
    case 'business_item':
      return parseTextSource(input);
    case 'media_asset':
      return parseTextSource(input);
    case 'payment_method':
      return parseTextSource(input);
  }
}

export { parseFaq, parseTiptap, parseBusinessItem, parseTextSource };
