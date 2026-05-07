import { describe, it, expect } from 'vitest';
import { parseTiptap, tiptapToMarkdown } from './tiptap';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, marks });
const h = (level: number, ...content: unknown[]) => ({
  type: 'heading',
  attrs: { level },
  content,
});

describe('tiptapToMarkdown', () => {
  it('renders headings and paragraphs', () => {
    const md = tiptapToMarkdown(doc(h(1, t('Title')), p(t('Hello world'))));
    expect(md).toBe('# Title\n\nHello world');
  });

  it('applies bold and italic marks', () => {
    const md = tiptapToMarkdown(
      doc(p(t('hi ', []), t('bold', [{ type: 'bold' }]), t(' ', []), t('it', [{ type: 'italic' }]))),
    );
    expect(md).toBe('hi **bold** *it*');
  });

  it('renders bullet lists', () => {
    const li = (text: string) => ({ type: 'listItem', content: [p(t(text))] });
    const md = tiptapToMarkdown(doc({ type: 'bulletList', content: [li('a'), li('b')] }));
    expect(md).toBe('- a\n- b');
  });

  it('renders ordered lists', () => {
    const li = (text: string) => ({ type: 'listItem', content: [p(t(text))] });
    const md = tiptapToMarkdown(doc({ type: 'orderedList', content: [li('a'), li('b')] }));
    expect(md).toBe('1. a\n2. b');
  });

  it('renders code blocks with language', () => {
    const md = tiptapToMarkdown(
      doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'x=1' }] }),
    );
    expect(md).toBe('```ts\nx=1\n```');
  });

  it('renders blockquote and hr', () => {
    const md = tiptapToMarkdown(
      doc({ type: 'blockquote', content: [p(t('quoted'))] }, { type: 'horizontalRule' }),
    );
    expect(md).toBe('> quoted\n\n---');
  });

  it('renders links', () => {
    const md = tiptapToMarkdown(
      doc(p(t('see ', []), t('here', [{ type: 'link', attrs: { href: 'https://x.test' } }]))),
    );
    expect(md).toBe('see [here](https://x.test)');
  });

  it('returns empty string on falsy input', () => {
    expect(tiptapToMarkdown(null)).toBe('');
    expect(tiptapToMarkdown(undefined)).toBe('');
  });

  it('renders asset mentions as @slug for media selector pickup', () => {
    const md = tiptapToMarkdown(
      doc(
        p(
          t('Send '),
          { type: 'mention', attrs: { id: 'review1', label: 'review1', kind: 'asset', mentionSuggestionChar: '@' } },
          t(' for proof'),
        ),
      ),
    );
    expect(md).toBe('Send @review1 for proof');
  });

  it('renders folder mentions as #folder-slug', () => {
    const md = tiptapToMarkdown(
      doc(
        p(
          t('See '),
          { type: 'mention', attrs: { id: 'reviews', label: 'reviews', kind: 'folder', mentionSuggestionChar: '#' } },
        ),
      ),
    );
    expect(md).toBe('See #reviews');
  });

  it('drops mention with missing label/id rather than emitting bare char', () => {
    const md = tiptapToMarkdown(
      doc(p(t('hi '), { type: 'mention', attrs: { kind: 'asset' } }, t(' there'))),
    );
    expect(md).toBe('hi  there');
  });
});

describe('parseTiptap', () => {
  it('keeps the existing H1 from the body', () => {
    const r = parseTiptap({ title: 'Ignored', contentJson: doc(h(1, t('Real')), p(t('body'))) });
    expect(r.markdown).toBe('# Real\n\nbody');
    expect(r.atomic).toBe(false);
  });

  it('prepends title when body has no H1', () => {
    const r = parseTiptap({ title: 'My Doc', contentJson: doc(p(t('body'))) });
    expect(r.markdown).toBe('# My Doc\n\nbody');
  });

  it('uses Untitled when title is empty', () => {
    const r = parseTiptap({ title: '   ', contentJson: doc(p(t('x'))) });
    expect(r.markdown).toBe('# Untitled\n\nx');
  });
});
