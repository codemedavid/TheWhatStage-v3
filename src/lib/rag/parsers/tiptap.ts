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
 * TipTap document → ParsedSource. The first H1 in the body wins as title;
 * if absent, the caller-supplied title is prepended as one.
 */
export function parseTiptap(input: { title: string; contentJson: unknown }): ParsedSource {
  const md = tiptapToMarkdown(input.contentJson);
  const hasH1 = /^#\s+/m.test(md);
  const title = input.title.trim() || 'Untitled';
  const markdown = hasH1 ? md : `# ${title}\n\n${md}`.trim();
  return { kind: 'document', title, markdown, atomic: false };
}
