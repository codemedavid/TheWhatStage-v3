// Shared types for the RAG pipeline. Kept dependency-free so any module
// (pure or networked) can import them without pulling in clients.

export type SourceKind = 'document' | 'faq' | 'business_item' | 'media_asset' | 'payment_method';

export interface ParsedSource {
  kind: SourceKind;
  /** Title or question, used as the implicit H1 if the body has none. */
  title: string;
  /** Markdown body. Always normalized to LF line endings. */
  markdown: string;
  /**
   * Marks the whole source as atomic — it must produce exactly one chunk
   * regardless of length (FAQs use this).
   */
  atomic: boolean;
}

export interface Chunk {
  /** 0-based, stable across edits. The (source, chunk_index) pair is the upsert key. */
  chunkIndex: number;
  /** Full text actually embedded — heading prefix already prepended. */
  content: string;
  /** "Refund policy > Eligibility" or null if no headings above the chunk. */
  headingPath: string | null;
  tokenCount: number;
  contentHash: string;
  isAtomic: boolean;
  /** Optional [start, end] char offset in the source markdown. */
  sourceOffset: { start: number; end: number } | null;
}

export interface ChunkDiff {
  insert: Chunk[];
  update: Chunk[];
  delete: number[]; // chunk_index values to remove
  skip: number[];   // chunk_index values whose hash matched (no work)
}
