import { vi } from 'vitest'

/**
 * Build a chainable Supabase query mock. Each callable method returns the
 * same object so `.from(t).select(x).eq(y, z).maybeSingle()` works. The
 * terminal value is what `await`-ing the chain resolves to.
 */
export function chain(terminal: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of [
    'select', 'eq', 'is', 'in', 'maybeSingle', 'single',
    'upsert', 'update', 'insert', 'delete', 'order', 'limit', 'lt', 'gt',
  ]) {
    obj[m] = vi.fn().mockReturnValue(obj)
  }
  ;(obj as { then?: (cb: (r: unknown) => unknown) => unknown }).then = (cb) =>
    Promise.resolve(cb(terminal))
  return obj as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    is: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    lt: ReturnType<typeof vi.fn>
    gt: ReturnType<typeof vi.fn>
    then: (cb: (r: unknown) => unknown) => Promise<unknown>
  }
}

/**
 * Per-table router. Pass a map { tableName: chain(...) } and feed it to
 * `mockFrom.mockImplementation(tableRouter(map))`.
 */
export function tableRouter(map: Record<string, ReturnType<typeof chain>>) {
  return (table: string) => {
    if (!map[table]) throw new Error(`unexpected table: ${table}`)
    return map[table]
  }
}

export function authUser(id = 'u1') {
  return { data: { user: { id, email: 'x@y.z' } }, error: null }
}
