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

export class HfRouterLlm {
  private client: OpenAI;
  private model: string;

  constructor(opts?: { token?: string; model?: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: opts?.token ?? ragConfig.hfToken,
      baseURL: opts?.baseURL ?? ragConfig.hfRouterBaseUrl,
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
    const r = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens,
      ...(opts.responseFormat
        ? { response_format: { type: opts.responseFormat } }
        : {}),
    });
    return r.choices[0]?.message?.content ?? '';
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
