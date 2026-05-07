import type { ParsedSource } from '../types';

// TipTap StarterKit produces a deterministic JSON tree. We walk it and
// emit GitHub-flavored markdown. Anything we don't recognize is ignored
// rather than blowing up — the editor schema may grow over time.

interface TNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function escapeText(s: string): string {
  // Escape only characters that would break markdown structure when wrapped
  // by inline marks. We deliberately do not escape inside fenced code blocks.
  return s.replace(/([\\`*_[\]])/g, '\\$1');
}

function applyMarks(text: string, marks?: TNode['marks']): string {
  if (!marks?.length) return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        out = `[${out}](${href})`;
        break;
      }
      // strike, underline, highlight, color, textStyle: drop styling, keep text
    }
  }
  return out;
}

function renderInline(nodes: TNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'text') return applyMarks(escapeText(n.text ?? ''), n.marks);
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'image') {
        const src = String(n.attrs?.src ?? '');
        const alt = String(n.attrs?.alt ?? '');
        return `![${alt}](${src})`;
      }
      if (n.type === 'mention') {
        // Media mentions: emit `@asset-slug` or `#folder-slug` so the RAG
        // chunk text carries the slug. The media selector greps for these
        // tokens to decide which images to attach to a reply.
        const kind = n.attrs?.kind;
        const char =
          kind === 'folder'
            ? '#'
            : (n.attrs?.mentionSuggestionChar as string | undefined) ?? '@';
        const label = (n.attrs?.label ?? n.attrs?.id ?? '') as string;
        if (!label) return '';
        return `${char}${label}`;
      }
      return '';
    })
    .join('');
}

function renderBlock(node: TNode, depth = 0): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => renderBlock(c, depth)).filter(Boolean).join('\n\n');

    case 'paragraph':
      return renderInline(node.content);

    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `${'#'.repeat(level)} ${renderInline(node.content)}`;
    }

    case 'blockquote': {
      const inner = (node.content ?? [])
        .map((c) => renderBlock(c, depth))
        .join('\n\n');
      return inner
        .split('\n')
        .map((line) => (line.length ? `> ${line}` : '>'))
        .join('\n');
    }

    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      return (node.content ?? [])
        .map((li, i) => {
          const marker = ordered ? `${i + 1}.` : '-';
          const inner = (li.content ?? [])
            .map((c) => renderBlock(c, depth + 1))
            .join('\n\n')
            .split('\n')
            .map((line, idx) => (idx === 0 ? `${marker} ${line}` : `  ${line}`))
            .join('\n');
          return inner;
        })
        .join('\n');
    }

    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '');
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return '```' + lang + '\n' + text + '\n```';
    }

    case 'horizontalRule':
      return '---';

    case 'hardBreak':
      return '  \n';

    default:
      // Unknown nodes: try to recurse into children, else drop.
      if (node.content?.length) {
        return node.content.map((c) => renderBlock(c, depth)).filter(Boolean).join('\n\n');
      }
      return '';
  }
}

export function tiptapToMarkdown(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  return renderBlock(json as TNode).replace(/\r\n?/g, '\n').trim();
}

/**
 * Walk the parsed JSON and detect mention/image nodes whose attrs were
 * stripped by an earlier Server Action serialisation bug. Stored as
 * `{ "type": "mention" }` with no `attrs`, these emit nothing from
 * `tiptapToMarkdown`, so the media selector can't see the slug. When this
 * corruption is detected we fall back to `content_text`, which the editor
 * computes from `renderText` and therefore preserves `@slug`/`#slug` inline.
 */
function jsonHasStrippedMentionAttrs(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const node = json as { type?: string; attrs?: unknown; content?: unknown[] };
  if (
    (node.type === 'mention' || node.type === 'image') &&
    (!node.attrs || typeof node.attrs !== 'object' || Object.keys(node.attrs as object).length === 0)
  ) {
    return true;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (jsonHasStrippedMentionAttrs(child)) return true;
    }
  }
  return false;
}

/**
 * TipTap document → ParsedSource. The first H1 in the body wins as title;
 * if absent, the caller-supplied title is prepended as one.
 *
 * `contentText` is optional and only consulted when the stored JSON has
 * stripped mention attrs (see `jsonHasStrippedMentionAttrs`). In that case we
 * use the editor's plain text — it carries `@slug` inline and keeps the
 * surrounding context the retriever needs.
 */
export function parseTiptap(input: {
  title: string;
  contentJson: unknown;
  contentText?: string | null;
}): ParsedSource {
  const title = input.title.trim() || 'Untitled';
  const useTextFallback =
    jsonHasStrippedMentionAttrs(input.contentJson) && !!input.contentText?.trim();
  const body = useTextFallback
    ? (input.contentText ?? '').replace(/\r\n?/g, '\n').trim()
    : tiptapToMarkdown(input.contentJson);
  const hasH1 = /^#\s+/m.test(body);
  const markdown = hasH1 ? body : `# ${title}\n\n${body}`.trim();
  return { kind: 'document', title, markdown, atomic: false };
}
