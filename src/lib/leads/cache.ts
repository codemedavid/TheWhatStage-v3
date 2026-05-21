const store = new Map<string, unknown>()

function makeKey(namespace: string, leadId: string, key: string): string {
  return `${namespace}:${leadId}:${key}`
}

export function leadCacheGet<T>(namespace: string, leadId: string, key: string): T | undefined {
  return store.get(makeKey(namespace, leadId, key)) as T | undefined
}

export function leadCacheSet<T>(namespace: string, leadId: string, key: string, value: T): void {
  store.set(makeKey(namespace, leadId, key), value)
}

export function leadCacheClear(leadId: string): void {
  const suffix = `:${leadId}:`
  for (const k of store.keys()) {
    if (k.includes(suffix)) store.delete(k)
  }
}

export function __leadCacheResetForTests(): void {
  store.clear()
}
