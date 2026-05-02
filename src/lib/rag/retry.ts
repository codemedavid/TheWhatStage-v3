import { ragConfig } from './config';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  max = ragConfig.embedRetryMax,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === max - 1) break;
      const cap = ragConfig.embedRetryMaxWaitMs;
      const wait = Math.min(cap, 500 * 2 ** i) + Math.floor(Math.random() * 250);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
