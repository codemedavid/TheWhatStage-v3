import OpenAI from 'openai';
import { ragConfig } from './config';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmStreamChunk {
  delta: string;
  done: boolean;
  raw?: unknown;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Prompt tokens served from the provider's automatic prefix (KV) cache on
   * this turn, when the route reports it. Null when the provider does not
   * surface a cache-hit count (treat as UNKNOWN, not "no cache"). Read from
   * the OpenRouter-normalized `usage.prompt_tokens_details.cached_tokens`
   * with a fallback to the DeepSeek-native `usage.prompt_cache_hit_tokens`.
   */
  cachedPromptTokens: number | null;
  /**
   * DeepSeek-native cache-MISS prompt-token count when present
   * (`prompt_tokens === hit + miss`). Null when unavailable. Additive
   * observability only.
   */
  cacheMissPromptTokens: number | null;
}

/**
 * Local typed view of the cache-hit fields a usage object may carry. The
 * OpenAI SDK already types `prompt_tokens_details.cached_tokens`; the
 * DeepSeek-native pass-through fields (`prompt_cache_hit_tokens` /
 * `prompt_cache_miss_tokens`) are not in the SDK types, so we read them
 * through this narrow interface rather than `any`.
 */
interface UsageWithCacheFields {
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage | null;
  finishReason: string | null;
  model: string;
}

export class HfRouterLlm {
  private client: OpenAI;
  private model: string;

  constructor(opts?: { token?: string; model?: string; baseURL?: string }) {
    const apiKey = opts?.token ?? ragConfig.llmApiKey;
    const baseURL = opts?.baseURL ?? ragConfig.llmBaseUrl;
    if (!apiKey) {
      throw new Error(
        `[rag.llm] no API key configured for ${baseURL}. Set RAG_LLM_API_KEY ` +
          `(or HF_TOKEN if using the HF router) and restart the dev server — ` +
          `Next.js only reads .env.local at startup.`,
      );
    }
    this.client = new OpenAI({
      apiKey,
      baseURL,
      // SDK auto-retries 429/5xx with exponential backoff and honors
      // Retry-After. Default is 2 — bump it so transient bursts don't
      // bubble up as worker job failures.
      maxRetries: 5,
      timeout: 60_000,
    });
    this.model = opts?.model ?? ragConfig.llmModel;
  }

  async complete(
    messages: LlmMessage[],
    opts: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'json_object';
    } = {},
  ): Promise<string> {
    const r = await this.completeWithUsage(messages, opts);
    return r.text;
  }

  /**
   * Same call as `complete()` but returns the underlying `{usage, finishReason}`
   * for observability. Existing callers can keep using `complete()` for the
   * plain string; cost-sensitive paths (chatbot answer/classify) use this.
   */
  async completeWithUsage(
    messages: LlmMessage[],
    opts: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'json_object';
    } = {},
  ): Promise<LlmCompletion> {
    const r = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens,
      ...(opts.responseFormat
        ? { response_format: { type: opts.responseFormat } }
        : {}),
    });
    const choice = r.choices[0];
    const usage = r.usage
      ? (() => {
          const u = r.usage as unknown as UsageWithCacheFields;
          const cachedPromptTokens =
            u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? null;
          const cacheMissPromptTokens = u.prompt_cache_miss_tokens ?? null;
          return {
            promptTokens: r.usage!.prompt_tokens ?? 0,
            completionTokens: r.usage!.completion_tokens ?? 0,
            totalTokens: r.usage!.total_tokens ?? 0,
            cachedPromptTokens,
            cacheMissPromptTokens,
          };
        })()
      : null;
    return {
      text: choice?.message?.content ?? '',
      usage,
      finishReason: choice?.finish_reason ?? null,
      model: this.model,
    };
  }

  async *stream(
    messages: LlmMessage[],
    opts: { temperature?: number; maxTokens?: number } = {},
  ): AsyncGenerator<LlmStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens,
      stream: true,
    });
    for await (const part of stream) {
      const delta = part.choices?.[0]?.delta?.content ?? '';
      const done = (part.choices?.[0]?.finish_reason ?? null) !== null;
      yield { delta, done, raw: part };
    }
  }

  /**
   * One-shot query rewriter for CRAG fallback. Kept terse and deterministic.
   */
  async rewriteQuery(q: string): Promise<string> {
    const out = await this.complete(
      [
        {
          role: 'system',
          content:
            'Rewrite the user query to maximize retrieval recall. Output ONLY the rewritten query, no preamble. Keep it under 25 words.',
        },
        { role: 'user', content: q },
      ],
      { temperature: 0, maxTokens: 64 },
    );
    return out.trim();
  }
}
