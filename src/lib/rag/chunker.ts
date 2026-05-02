import { createHash } from 'node:crypto';
import type { Chunk, ParsedSource } from './types';

export interface ChunkerOptions {
  /** Approximate target tokens per chunk. */
  targetTokens?: number;
  /** Hard upper bound (we never exceed this except for atomic blocks). */
  maxTokens?: number;
  /** Overlap tokens between adjacent chunks at the same heading. */
  overlapTokens?: number;
  /**
   * Token estimator. Default is a deterministic ~4 chars/token approximation,
   * good enough for sizing decisions. Swap for js-tiktoken in production if
   * tighter bounds matter.
   */
  estimateTokens?: (text: string) => number;
}

const DEFAULT_TARGET = 800;
const DEFAULT_MAX = 1024;
const DEFAULT_OVERLAP = 100;
const APPROX_CHARS_PER_TOKEN = 4;

const defaultEstimate = (text: string): number =>
  Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

interface Section {
  parents: string[];
  heading: string | null;
  level: number;
  body: string;
  start: number;
}

function splitSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  const stack: Array<{ level: number; heading: string }> = [];
  let cur: Section = { parents: [], heading: null, level: 0, body: '', start: 0 };
  let inFence = false;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length + 1;
    if (/^```/.test(line.trim())) inFence = !inFence;

    const headingMatch = !inFence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch) {
      sections.push(cur);
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parents = stack.map((s) => s.heading);
      cur = { parents, heading, level, body: '', start: charOffset };
      stack.push({ level, heading });
    } else {
      cur.body += (cur.body ? '\n' : '') + line;
    }
    charOffset += lineLen;
  }
  sections.push(cur);

  return sections.filter((s) => s.heading !== null || s.body.trim().length > 0);
}

const headingPathOf = (s: Section): string | null => {
  const parts = [...s.parents, ...(s.heading ? [s.heading] : [])];
  return parts.length ? parts.join(' > ') : null;
};

interface Piece { text: string; start: number; end: number }

function splitByPattern(body: string, re: RegExp): Piece[] {
  const parts: Piece[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: body.slice(last, idx), start: last, end: idx });
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), start: last, end: body.length });
  return parts;
}

function recursiveSplit(body: string, budget: number, estimate: (s: string) => number): Piece[] {
  if (estimate(body) <= budget) {
    return body.length ? [{ text: body, start: 0, end: body.length }] : [];
  }

  const separators: RegExp[] = [
    /\n{2,}/g,
    /\n/g,
    /(?<=[.!?])\s+/g,
    /\s+/g,
  ];

  for (const re of separators) {
    const parts = splitByPattern(body, re);
    if (parts.length <= 1) continue;

    const packed: Piece[] = [];
    let buf = '';
    let bufStart = -1;
    let bufEnd = -1;
    const flush = () => {
      if (bufStart >= 0) packed.push({ text: buf, start: bufStart, end: bufEnd });
      buf = '';
      bufStart = -1;
      bufEnd = -1;
    };
    for (const part of parts) {
      if (estimate(part.text) > budget) {
        flush();
        const sub = recursiveSplit(part.text, budget, estimate);
        for (const s of sub) {
          packed.push({ text: s.text, start: part.start + s.start, end: part.start + s.end });
        }
        continue;
      }
      const candidate = buf ? buf + '\n\n' + part.text : part.text;
      if (estimate(candidate) > budget && buf) {
        flush();
        buf = part.text;
        bufStart = part.start;
        bufEnd = part.end;
      } else {
        if (!buf) bufStart = part.start;
        buf = candidate;
        bufEnd = part.end;
      }
    }
    flush();
    if (packed.length) return packed;
  }

  // Last resort: hard char-based slice.
  const sliceLen = budget * APPROX_CHARS_PER_TOKEN;
  const out: Piece[] = [];
  for (let i = 0; i < body.length; i += sliceLen) {
    out.push({ text: body.slice(i, i + sliceLen), start: i, end: Math.min(body.length, i + sliceLen) });
  }
  return out;
}

const tailTokens = (text: string, n: number, estimate: (s: string) => number): string => {
  if (estimate(text) <= n) return text;
  const words = text.split(/\s+/);
  let buf = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const cand = words[i] + (buf ? ' ' + buf : '');
    if (estimate(cand) > n) break;
    buf = cand;
  }
  return buf;
};

export function chunk(source: ParsedSource, opts: ChunkerOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? DEFAULT_TARGET;
  const max = opts.maxTokens ?? DEFAULT_MAX;
  const overlap = opts.overlapTokens ?? DEFAULT_OVERLAP;
  const estimate = opts.estimateTokens ?? defaultEstimate;

  const md = source.markdown.replace(/\r\n?/g, '\n').trim();
  if (!md) return [];

  if (source.atomic) {
    const m = /^#\s+(.+)$/m.exec(md);
    const headingPath = m ? m[1].trim() : null;
    return [
      {
        chunkIndex: 0,
        content: md,
        headingPath,
        tokenCount: estimate(md),
        contentHash: sha256(md),
        isAtomic: true,
        sourceOffset: { start: 0, end: md.length },
      },
    ];
  }

  const sections = splitSections(md);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const headingPath = headingPathOf(section);
    const prefix = headingPath ? `# ${headingPath}\n\n` : '';
    const body = section.body.trim();
    if (!body) continue;

    const prefixTokens = estimate(prefix);
    const bodyBudget = Math.max(1, target - prefixTokens);
    const bodyMax = Math.max(1, max - prefixTokens);

    const pieces = recursiveSplit(body, bodyBudget, estimate);
    let prevTail = '';
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const overlapText = i > 0 && overlap > 0 && prevTail ? prevTail + '\n\n' : '';
      let content = prefix + overlapText + piece.text;

      if (estimate(content) > bodyMax + prefixTokens) {
        content = prefix + piece.text;
      }

      chunks.push({
        chunkIndex: chunks.length,
        content,
        headingPath,
        tokenCount: estimate(content),
        contentHash: sha256(content),
        isAtomic: false,
        sourceOffset: {
          start: section.start + piece.start,
          end: section.start + piece.end,
        },
      });
      prevTail = tailTokens(piece.text, overlap, estimate);
    }
  }

  return chunks;
}
