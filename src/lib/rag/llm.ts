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
      ? {
          promptTokens: r.usage.prompt_tokens ?? 0,
          completionTokens: r.usage.completion_tokens ?? 0,
          totalTokens: r.usage.total_tokens ?? 0,
        }
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
