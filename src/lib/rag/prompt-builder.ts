import type { GradedBuckets } from './grader';
import type { RetrievedChunk } from './retriever';

export interface ChatbotPersona {
  /** Display name the assistant uses for itself. */
  name: string;
  /** One-paragraph identity / brand voice. */
  persona: string;
  /** Numbered DO rules. Empty array = none. */
  doRules: string[];
  /** Numbered DON'T rules. Empty array = none. */
  dontRules: string[];
  /** Exact phrase to use when context is missing. */
  fallbackMessage: string;
  /**
   * Primary goal injected from the lead's active funnel.
   * Placed at the top of the system prompt so the LLM treats it as the
   * highest-priority directive, above identity and style rules.
   */
  funnelInstruction?: string;
  /**
   * Free-form instructions for the bot — what it should focus on, how it
   * should handle specific situations, etc. Injected before the rules so
   * it acts as persistent directive context.
   */
  instructions?: string;
}

export interface BuildPromptArgs {
  userQuery: string;
  buckets: GradedBuckets<RetrievedChunk>;
  /** Structured config. Falls back to DEFAULT_CHATBOT_PERSONA. */
  config?: Partial<ChatbotPersona>;
  /** Legacy: full freeform persona block. Wins over `config` if provided. */
  persona?: string;
  /** Maximum context chunks to include (after grading). */
  maxContext?: number;
  /** Rolling summary of older turns, injected before the knowledge context. */
  conversationSummary?: string;
}

export const DEFAULT_CHATBOT_PERSONA: ChatbotPersona = {
  name: 'Assistant',
  persona:
    "You are a warm, helpful AI assistant for a Filipino business. You speak like a thoughtful concierge — friendly, efficient, never pushy.",
  doRules: [
    'Mirror the user\'s language exactly: pure Tagalog, English, or Taglish — match their register and slang.',
    'Stay concise. Default to under 80 words; expand only when the user asks for detail.',
    'Ask one short clarifying question if the request is ambiguous before answering.',
  ],
  dontRules: [
    'Never invent prices, links, hours, names, or policies. If a fact is not in the knowledge base, say so plainly.',
    'Do not promise anything that is not explicitly in the knowledge base.',
    'Avoid markdown headings and emoji unless the user uses them first. Light bullets only when listing 3+ items.',
    'Do not claim to be human. If asked, say you are an AI assistant for the business.',
  ],
  fallbackMessage:
    "Sorry, wala akong info diyan. Pwede kong i-check sa owner para sa'yo.",
};

export interface BuiltPrompt {
  system: string;
  user: string;
  contextChunkIds: string[];
  contextChunks: RetrievedChunk[];
}

function numbered(items: string[]): string {
  return items.length === 0
    ? '(none)'
    : items.map((line, i) => `${i + 1}. ${line.trim()}`).join('\n');
}

function buildContextBlock(chunks: Array<RetrievedChunk & { score: number }>): string {
  if (chunks.length === 0) return '(no relevant context found)';
  return chunks
    .map((c, i) => `[${i + 1}]\n${c.content.trim()}`)
    .join('\n\n---\n\n');
}

function assembleSystemPrompt(p: ChatbotPersona, contextBlock: string, conversationSummary?: string): string {
  const goalSection = p.funnelInstruction?.trim()
    ? [
        `# PRIMARY GOAL (Follow this above all else)`,
        p.funnelInstruction.trim(),
        ``,
      ]
    : [];

  const instructionsSection = p.instructions?.trim()
    ? [
        `# Instructions`,
        p.instructions.trim(),
        ``,
      ]
    : [];

  const summarySection = conversationSummary?.trim()
    ? [
        `# Earlier Conversation (summary)`,
        conversationSummary.trim(),
        ``,
      ]
    : [];

  return [
    ...goalSection,
    ...instructionsSection,
    `# Identity`,
    `You are ${p.name}. ${p.persona.trim()}`,
    `Stay fully in this voice for every reply — tone, pacing, signature phrasing, and length all flow from the Identity, Instructions, and Rules above. Do NOT fall back to a generic "warm concise concierge" tone unless the persona itself describes that.`,
    ``,
    `# Rules — DO`,
    numbered(p.doRules),
    ``,
    `# Rules — DON'T`,
    numbered(p.dontRules),
    ``,
    `# Grounding`,
    `- Treat the knowledge base context below as the single source of truth for facts.`,
    `- If a specific fact is not present in the context, do NOT guess — use the fallback below.`,
    `- Never name, quote, or reference the source documents, FAQs, headings, or chunk numbers in your reply. Speak the answer directly to the user as your own knowledge.`,
    ``,
    `# Fallback`,
    `If you cannot answer from the context, reply with this message verbatim, then offer one short next step:`,
    `"${p.fallbackMessage.trim()}"`,
    ``,
    ...summarySection,
    `# Knowledge base context`,
    contextBlock,
  ].join('\n');
}

export function buildPrompt(args: BuildPromptArgs): BuiltPrompt {
  const max = args.maxContext ?? 12;
  const ranked = [...args.buckets.useful, ...args.buckets.ambiguous]
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  const contextBlock = buildContextBlock(ranked);

  const contextChunks = ranked.map(({ score: _score, ...c }) => c);

  // Legacy escape hatch: full freeform persona block.
  if (args.persona) {
    const system = `${args.persona}\n\n# Knowledge base context\n${contextBlock}`;
    return { system, user: args.userQuery, contextChunkIds: ranked.map((c) => c.id), contextChunks };
  }

  const merged: ChatbotPersona = {
    ...DEFAULT_CHATBOT_PERSONA,
    ...(args.config ?? {}),
  };

  return {
    system: assembleSystemPrompt(merged, contextBlock, args.conversationSummary),
    user: args.userQuery,
    contextChunkIds: ranked.map((c) => c.id),
    contextChunks,
  };
}
