import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OpenAI SDK so completeWithUsage runs with no network. The mocked
// client exposes the same `chat.completions.create` surface the real client
// does; each test feeds a different `usage` shape to exercise the
// cached-token mapping (OpenRouter-normalized field, DeepSeek-native
// fallback, and the neither-present null case).
const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

function completionWith(usage: Record<string, unknown> | undefined) {
  return {
    choices: [{ message: { content: '{"reply":"ok"}' }, finish_reason: 'stop' }],
    usage,
  };
}

beforeEach(() => {
  createMock.mockReset();
  process.env.RAG_LLM_API_KEY = 'test-key';
});

afterEach(() => {
  vi.resetModules();
  delete process.env.RAG_LLM_API_KEY;
});

describe('completeWithUsage — cached prompt-token mapping', () => {
  it('reads OpenRouter-normalized usage.prompt_tokens_details.cached_tokens', async () => {
    createMock.mockResolvedValueOnce(
      completionWith({
        prompt_tokens: 5300,
        completion_tokens: 80,
        total_tokens: 5380,
        prompt_tokens_details: { cached_tokens: 5120 },
      }),
    );
    const { HfRouterLlm } = await import('./llm');
    const r = await new HfRouterLlm({ token: 't' }).completeWithUsage([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(r.usage?.promptTokens).toBe(5300);
    expect(r.usage?.cachedPromptTokens).toBe(5120);
  });

  it('falls back to DeepSeek-native prompt_cache_hit_tokens when prompt_tokens_details is absent', async () => {
    createMock.mockResolvedValueOnce(
      completionWith({
        prompt_tokens: 5300,
        completion_tokens: 80,
        total_tokens: 5380,
        prompt_cache_hit_tokens: 4096,
        prompt_cache_miss_tokens: 1204,
      }),
    );
    const { HfRouterLlm } = await import('./llm');
    const r = await new HfRouterLlm({ token: 't' }).completeWithUsage([
      { role: 'user', content: 'hi' },
    ]);
    expect(r.usage?.cachedPromptTokens).toBe(4096);
    expect(r.usage?.cacheMissPromptTokens).toBe(1204);
  });

  it('prefers prompt_tokens_details.cached_tokens over prompt_cache_hit_tokens when both present', async () => {
    createMock.mockResolvedValueOnce(
      completionWith({
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 110,
        prompt_tokens_details: { cached_tokens: 64 },
        prompt_cache_hit_tokens: 999,
      }),
    );
    const { HfRouterLlm } = await import('./llm');
    const r = await new HfRouterLlm({ token: 't' }).completeWithUsage([
      { role: 'user', content: 'hi' },
    ]);
    expect(r.usage?.cachedPromptTokens).toBe(64);
  });

  it('yields null cachedPromptTokens when neither field is present (UNKNOWN, not no-cache)', async () => {
    createMock.mockResolvedValueOnce(
      completionWith({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }),
    );
    const { HfRouterLlm } = await import('./llm');
    const r = await new HfRouterLlm({ token: 't' }).completeWithUsage([
      { role: 'user', content: 'hi' },
    ]);
    expect(r.usage?.cachedPromptTokens).toBeNull();
    expect(r.usage?.cacheMissPromptTokens).toBeNull();
  });

  it('returns null usage when the provider omits usage entirely', async () => {
    createMock.mockResolvedValueOnce(completionWith(undefined));
    const { HfRouterLlm } = await import('./llm');
    const r = await new HfRouterLlm({ token: 't' }).completeWithUsage([
      { role: 'user', content: 'hi' },
    ]);
    expect(r.usage).toBeNull();
  });
});
